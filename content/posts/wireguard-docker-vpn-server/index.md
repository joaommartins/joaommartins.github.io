---
title: Running WireGuard as Client and Server in Docker with PiHole and Traefik
date: "2026-02-23T10:00:00.000Z"
draft: false
slug: "wireguard-docker-vpn-server"
category: "Networking"
tags:
- "Docker"
- "WireGuard"
- "VPN"
- "PiHole"
- "Traefik"
- "ntfy"
description: "How to extend the WireGuard Docker container to act as both a VPN client and server, with PiHole for DNS, Traefik as a reverse proxy, and services that bypass the kill switch."
socialImage: "/wireguard_logo.png"
---

> **TL;DR** If you want to skip straight to the goods, the GitHub repository from the previous article has been updated
> with the full client-server configuration, PiHole and Traefik setup:
> [here](https://github.com/joaommartins/wireguard-network-stack).

If you've read the [previous article](/posts/wireguard-docker-killswitch), you'll know that I promised a follow-up
covering the evolution of my WireGuard Docker stack. What started as a single VPN client container with a kill switch
has since grown into something more ambitious: a single WireGuard container acting as both a Mullvad VPN client _and_
a WireGuard server, with PiHole handling DNS for every device on the network and Traefik managing HTTPS reverse proxying
for all self-hosted services. That's a lot happening in one container's network namespace, but it works well and is
straightforward to configure once you understand how the pieces fit together.

The goal is straightforward: connect my devices to my home server from anywhere in the world, access all self-hosted
services over HTTPS with valid certificates, have PiHole block ads on every connected device, and have all outbound
traffic exit through Mullvad VPN. If the VPN connection drops, nothing gets through. _Fail closed_, as we discussed in
the previous article.

## The Architecture

Before diving into configuration files, let me outline what we're building. The WireGuard container sits at the centre
of everything. It runs two WireGuard interfaces simultaneously: `wg0` acts as the server, accepting connections from
remote clients like my laptop and phone, while `wg1` acts as the VPN client, tunnelling outbound traffic through
Mullvad. PiHole and Traefik both run on the WireGuard container's network stack using Docker's
`network_mode: service:wireguard`[^network-mode], meaning they share its network interfaces — including both WireGuard
tunnels.

When a remote client connects via WireGuard, their traffic enters through `wg0`, gets forwarded through the container,
and exits via `wg1` to Mullvad. DNS queries go to PiHole (running on the tunnel IP), which blocks ads and resolves
`*.jmartins.dev` to the tunnel address where Traefik is listening. Traefik then routes the request to the correct
service based on the hostname. All of this happens without any service being directly exposed to the internet.

## Two Interfaces, One Container

In the [previous article](/posts/wireguard-docker-killswitch), our WireGuard container ran a single interface (`wg0`)
as a Mullvad VPN client. Now we need two: a server interface for accepting remote connections and a client interface
for the outbound VPN tunnel. The Linuxserver.io WireGuard image makes this relatively painless.

### The Server Interface

Setting the `PEERS` environment variable on the Linuxserver.io WireGuard container triggers its server
mode[^linuxserver-wireguard]. The image generates a server configuration and individual peer configurations that can
be imported on your devices.

```yaml
### DOCKER-COMPOSE.YAML — WIREGUARD SERVICE (PARTIAL) ###
services:
  wireguard:
    image: lscr.io/linuxserver/wireguard:latest
    container_name: wireguard
    hostname: wireguard
    cap_add:
      - NET_ADMIN
    environment:
      - PUID=${PUID}
      - PGID=${PGID}
      - TZ=${TZ}
      - PEERS=laptop,phone
      - SERVERURL=wireguard.example.com
      - SERVERPORT=${WIREGUARD_PORT}
      - INTERNAL_SUBNET=10.0.2.0/24
      - PEERDNS=10.0.2.1
      - ALLOWEDIPS=0.0.0.0/0
      - LOG_CONFS=false
    volumes:
      - ${CONFIG_DIR}/wireguard:/config
      - ${CONFIG_DIR}/wireguard_startup:/custom-cont-init.d:ro
    ports:
      - 80:80
      - 443:443
      - ${WIREGUARD_PORT}:${WIREGUARD_PORT}/udp
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
    healthcheck:
      test: ping -c 1 1.1.1.1 || exit 1
      interval: 2s
      start_period: 10s
      start_interval: 2s  # requires Docker Compose v2.20+ / Docker Engine 25+
      timeout: 5s
      retries: 3
    restart: always
```

A few things stand out compared to the previous article. We're now exposing the WireGuard port (UDP only — WireGuard
doesn't use TCP) for incoming peer connections, as well as ports 80 and 443 for the web services we'll be routing
through Traefik later. The `PEERDNS`
variable tells the generated peer configurations to use `10.0.2.1` as their DNS server — this will be PiHole, running
on the WireGuard container's network stack at the server's tunnel address. `ALLOWEDIPS=0.0.0.0/0` means the generated
peer configs will route _all_ client traffic through the tunnel, not just traffic destined for the server's subnet.
`LOG_CONFS=false` prevents the image from logging the generated configurations to the container output, which you
probably want when your private keys are involved.

On first run, the image generates a server configuration in `/config/wg_confs/wg0.conf` along with peer configurations
in `/config/peer_laptop/`, `/config/peer_phone/`, and so on. The generated config needs forwarding and NAT rules to
route peer traffic through the Mullvad tunnel. Rather than editing `wg0.conf` by hand every time the image regenerates
it, our startup script (covered below) patches it automatically. The result looks like this:

```ini
[Interface]
Address = 10.0.2.1
ListenPort = 51820
PrivateKey = [REDACTED]
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o wg1 -j MASQUERADE; iptables -t nat -A POSTROUTING -s 10.0.2.0/24 -o eth0 -j MASQUERADE
FwMark = 51820

[Peer] # peer_laptop
PublicKey = [REDACTED]
AllowedIPs = 10.0.2.2/32

[Peer] # peer_phone
PublicKey = [REDACTED]
AllowedIPs = 10.0.2.3/32
```

The `PostUp` directive is the key to the dual-interface setup. When the server interface comes up, it:

1. Allows packet forwarding in both directions through `wg0`, so traffic from peers can be routed through the container.
2. Masquerades all traffic leaving through `wg1` (the Mullvad tunnel), so peers' outbound internet traffic appears to
   originate from the container's Mullvad VPN address.
3. Masquerades traffic from the WireGuard subnet (`10.0.2.0/24`) leaving through `eth0` (the Docker bridge interface),
   so peers can reach services on the local network and other Docker containers.

The `FwMark = 51820` is critical — it marks the server's own encrypted UDP packets with this value. As we'll see when
we update the kill switch, these marked packets are exempt from the outbound blocking rules, allowing the server to
communicate with its remote peers regardless of the state of the Mullvad connection.

You'll notice there's no corresponding `PostDown` directive to clean up these iptables rules. In a Docker context this
is fine — restarting the interface means restarting the entire container, which resets iptables state. If you adapt this
setup for a non-containerised host, you'll want to add `PostDown` rules that mirror the `PostUp` with `-D` (delete)
instead of `-A` (append) to avoid accumulating duplicate rules on interface restarts.

### The Client Interface

The Mullvad VPN client configuration from the previous article is now `wg1.conf` instead of `wg0.conf`, placed directly
in the `/config` directory. The configuration is largely the same, with one important change:

```ini
[Interface]
PrivateKey = [REDACTED]
Address = 10.64.114.74/32
DNS = 127.0.0.1

[Peer]
PublicKey = [REDACTED]
AllowedIPs = 0.0.0.0/0
Endpoint = 89.44.10.178:51820
```

The `DNS` field now points to `127.0.0.1` instead of Mullvad's DNS server. Since PiHole runs on the WireGuard
container's network stack, `localhost` resolves to PiHole. This means even the container's own DNS queries go through
PiHole, getting the benefit of ad blocking and our custom domain resolution.

There's a subtlety here: `wg-quick up` sets `127.0.0.1` as the system resolver when it brings up `wg1`, but PiHole
hasn't started yet at this point (it depends on the WireGuard container being healthy first). This creates a brief
window where DNS is unavailable inside the container. In practice this doesn't matter — the healthcheck uses an IP
address (`ping -c 1 1.1.1.1`), and the dependency chain ensures no service that needs DNS starts until PiHole is up.
Just be aware of this if you modify the startup order.

We've also removed the `PostUp` kill switch directive from the client config. As we discussed in the previous article,
relying on the WireGuard configuration file for the kill switch means a parsing error could leave us in a _fail open_
state. We'll continue handling the kill switch in the startup script instead.

## The Updated Kill Switch

With two WireGuard interfaces, the startup script from the previous article needs updating. The kill switch now targets
`wg1` (the Mullvad tunnel) instead of `wg0`, and we need to handle the client connection startup ourselves since the
Linuxserver.io image only manages the server interface automatically.

The script also has a new responsibility: patching the generated `wg0.conf` with the custom `PostUp` and `FwMark`
directives described above. The Linuxserver.io image regenerates `wg0.conf` with a default `PostUp` that only covers
basic forwarding — it doesn't know about our Mullvad tunnel or LAN access requirements. Rather than manually editing
the config after each regeneration, the script handles it idempotently on every startup.

```bash
#!/bin/bash

# Patch wg0.conf with forwarding, NAT, and FwMark if not already present.
# The Linuxserver.io image generates a bare wg0.conf with a default PostUp
# that only covers basic forwarding. The dual-interface (client+server) setup
# needs custom rules for routing through wg1 (Mullvad) and LAN access.
WG0_CONF="/config/wg_confs/wg0.conf"
POSTUP='PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o wg1 -j MASQUERADE; iptables -t nat -A POSTROUTING -s 10.0.2.0/24 -o eth0 -j MASQUERADE'

if [ -f "$WG0_CONF" ]; then
    # Check if our custom PostUp is present (look for wg1 masquerade specifically)
    if grep -q "POSTROUTING -o wg1" "$WG0_CONF"; then
        echo "**** wg0.conf: custom PostUp already present ****"
    elif grep -q "^PostUp" "$WG0_CONF"; then
        # Default PostUp exists but missing our custom rules — replace it
        sed -i "s|^PostUp.*|$POSTUP|" "$WG0_CONF"
        echo "**** Patched wg0.conf: replaced default PostUp with custom rules ****"
    else
        # No PostUp at all — insert after PrivateKey
        sed -i "/^PrivateKey/a\\$POSTUP" "$WG0_CONF"
        echo "**** Patched wg0.conf: added PostUp ****"
    fi

    if ! grep -q "^FwMark" "$WG0_CONF"; then
        sed -i "/^PostUp/a\\FwMark = 51820" "$WG0_CONF"
        echo "**** Patched wg0.conf: added FwMark ****"
    fi
fi

echo "**** Adding iptables rules ****"

DROUTE=$(ip route | grep default | awk '{print $3}')
HOMENET=192.168.0.0/16
HOMENET2=10.0.0.0/8
HOMENET3=172.16.0.0/12

# Add routes for private networks (tolerant of pre-existing routes)
ip route add $HOMENET3 via $DROUTE 2>/dev/null || true
ip route add $HOMENET2 via $DROUTE 2>/dev/null || true
ip route add $HOMENET  via $DROUTE 2>/dev/null || true

# Allow traffic to private networks
iptables -I OUTPUT -d $HOMENET  -j ACCEPT
iptables -A OUTPUT -d $HOMENET2 -j ACCEPT
iptables -A OUTPUT -d $HOMENET3 -j ACCEPT

# Kill switch
iptables -A OUTPUT ! -o wg1 -m mark ! --mark 0xca6c -m addrtype ! --dst-type LOCAL -j REJECT

wg-quick up /config/wg1.conf

echo "**** Successfully added iptables rules ****"
```

This script runs during container initialisation, before either WireGuard interface is brought
up[^custom-cont-init]. Compared to the script from the previous article, there are four important changes:

1. **Automatic `wg0.conf` patching**: The script checks whether the generated server config already has our custom
   `PostUp` and `FwMark` directives. If the image has regenerated a default config, the script replaces the `PostUp`
   line and adds `FwMark`. The check is idempotent — if the custom rules are already present, it does nothing. This
   means you never need to manually edit the generated config, even after adding or removing peers.

2. **Local network routes**: We add explicit routes for RFC 1918[^rfc1918] private address ranges via the container's
   default gateway. Without these, traffic destined for the Docker networks and your home network would attempt to route
   through the VPN tunnel. The corresponding `iptables` rules ensure that outbound traffic to these subnets is always
   allowed, regardless of the kill switch state. The route additions are tolerant of pre-existing entries — on a
   container restart, these routes may already exist, so the script suppresses the error rather than failing.

3. **Kill switch targeting `wg1`**: The kill switch rule now references `wg1` instead of `wg0`. It rejects all outbound
   traffic that is _not_ going through the Mullvad tunnel, _not_ marked with `0xca6c` (the hexadecimal representation
   of port 51820), and _not_ destined for a local address. The `FwMark = 51820` we set on the server interface ensures
   its encrypted packets to remote peers are marked and thus exempted — without this, the server wouldn't be able to
   communicate with its clients.

4. **Manual client startup**: We bring up `wg1` ourselves with `wg-quick up`. The Linuxserver.io image handles `wg0`
   (the server), but since `wg1` is our custom addition, we need to start it explicitly.

The execution order is then:

1. Container starts, startup script runs.
2. `wg0.conf` is patched with custom `PostUp` and `FwMark` (if needed).
3. Kill switch and local network rules are set — outbound internet traffic is now _blocked_.
4. `wg1` (Mullvad client) is brought up — outbound traffic through the VPN is now _allowed_.
5. Linuxserver.io image brings up `wg0` (server) with our patched config — remote peers can now connect.

If the startup script fails or the Mullvad connection cannot be established, the kill switch is already in place. _Fail closed._

## PiHole: DNS for the Stack and Beyond

PiHole[^pihole] needs no introduction to the self-hosting crowd, but its role in this stack goes beyond blocking ads.
By running PiHole on the WireGuard container's network stack, it becomes the DNS server for both local containers _and_
remote WireGuard peers.

```yaml
### DOCKER-COMPOSE.YAML — PIHOLE SERVICE ###
  pihole:
    container_name: pihole
    image: pihole/pihole:latest
    network_mode: service:wireguard
    depends_on:
      wireguard:
        condition: service_healthy
    healthcheck:
      test: ping -c 1 google.com || exit 1
      interval: 2s
      start_period: 10s
      start_interval: 2s
      timeout: 5s
      retries: 3
    environment:
      TZ: ${TZ}
      FTLCONF_webserver_port: ${PIHOLE_WEBUI_PORT}
      FTLCONF_webserver_api_password: ${PIHOLE_PASSWORD}
      FTLCONF_dns_upstreams: '1.1.1.1'
      FTLCONF_dns_dnssec: true
      FTLCONF_dns_revServers: 'true,192.168.1.0/24,192.168.1.1,lan'
      FTLCONF_misc_dnsmasq_lines: "address=/jmartins.dev/10.0.2.1;server=/proxy/127.0.0.11"
    cap_add:
      - NET_ADMIN
    volumes:
      - ${CONFIG_DIR}/pihole/etc-pihole/:/etc/pihole/
      - ${CONFIG_DIR}/pihole/etc-dnsmasq.d/:/etc/dnsmasq.d/
    restart: always
```

The `network_mode: service:wireguard` directive means PiHole shares the WireGuard container's entire network namespace
— all its interfaces, IP addresses, and routing tables. Since the WireGuard server's tunnel address is `10.0.2.1`,
PiHole is reachable at `10.0.2.1:53` from any connected peer.

The important line here is:

```text
FTLCONF_misc_dnsmasq_lines: "address=/jmartins.dev/10.0.2.1;server=/proxy/127.0.0.11"
```

This packs two dnsmasq directives into a single environment variable, separated by a semicolon:

1. `address=/jmartins.dev/10.0.2.1` tells PiHole to resolve _any_ subdomain of `jmartins.dev` to `10.0.2.1`. So when
   a remote client's browser requests `jellyfin.jmartins.dev`, PiHole responds with `10.0.2.1` — the WireGuard tunnel
   address where Traefik is listening. The request stays inside the tunnel the entire way.

2. `server=/proxy/127.0.0.11` is a conditional DNS forward. When `wg-quick` brings up the Mullvad client, it overwrites
   `/etc/resolv.conf` inside the container to point at `127.0.0.1` (PiHole). That's fine for external domains, but
   Traefik needs to resolve the hostname `proxy` to reach the Docker Socket Proxy at `tcp://proxy:2375`. PiHole doesn't
   know about Docker container names — only Docker's embedded DNS at `127.0.0.11` does. This directive tells dnsmasq to
   forward queries for `proxy` specifically to Docker's DNS resolver, while everything else continues through the normal
   upstream. No DNS leak, no broad forwarding — just the one hostname Traefik needs.

Upstream DNS is set to `1.1.1.1` (Cloudflare), with DNSSEC enabled for good measure. Since all outbound traffic from
the container exits through the Mullvad VPN, even these upstream DNS queries are encrypted and anonymised.

Remember that we set `PEERDNS=10.0.2.1` in the WireGuard container's environment. This means the auto-generated peer
configurations include `DNS = 10.0.2.1`, so every device that connects via WireGuard automatically uses PiHole. No
client-side configuration needed — your phone gets ad blocking the moment it connects to the VPN.

> ### Note on PiHole healthcheck
>
> PiHole's healthcheck pings `google.com` rather than an IP address. This is intentional — it validates that both
> the VPN connection _and_ DNS resolution are working. Services that depend on PiHole
> (`depends_on: pihole: condition: service_healthy`) won't start until DNS is fully operational, preventing a cascade
> of failures from containers that can't resolve hostnames.

## Traefik: The Reverse Proxy

With DNS sorted, we need something to actually handle the HTTPS requests arriving at `10.0.2.1`. Enter
Traefik[^traefik], a reverse proxy that can automatically discover Docker services and route traffic based on labels.

### Docker Socket Proxy

Before configuring Traefik, a brief detour on security. Traefik's Docker provider needs access to the Docker socket to
discover services, but mounting `/var/run/docker.sock` directly into a container exposes the full Docker API, which
effectively grants root-equivalent access to the host. If Traefik were ever compromised, the attacker would have
unrestricted control over every container and volume on the machine.

Instead, we use a Docker Socket Proxy[^docker-socket-proxy] that exposes only the specific Docker API endpoints Traefik
needs:

```yaml
### DOCKER-COMPOSE.YAML — DOCKER SOCKET PROXY ###
  proxy:
    image: tecnativa/docker-socket-proxy
    container_name: proxy
    environment:
      - CONTAINERS=1
      - SERVICES=1
      - NETWORKS=1
      - TASKS=1
      - IMAGES=1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - internal
    restart: always
```

The proxy runs on a dedicated internal Docker network marked with `internal: true`, meaning containers on this network
cannot access the internet. Only containers explicitly connected to the internal network can reach the proxy. We'll need
the WireGuard container connected to both the default and internal networks so that Traefik (running on its network
stack) can reach the proxy by its container hostname.

### The Traefik Service

```yaml
### DOCKER-COMPOSE.YAML — TRAEFIK SERVICE ###
  traefik:
    image: traefik
    container_name: traefik
    network_mode: service:wireguard
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - ${CONFIG_DIR}/traefik/letsencrypt:/letsencrypt
    command:
      - --api.dashboard=true
      # LetsEncrypt with Cloudflare DNS challenge
      - --certificatesresolvers.letsencrypt.acme.dnschallenge=true
      - --certificatesresolvers.letsencrypt.acme.dnschallenge.provider=cloudflare
      - --certificatesresolvers.letsencrypt.acme.email=me@example.com
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      # Entrypoints
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --entrypoints.web.http.redirections.entryPoint.to=websecure
      - --entrypoints.web.http.redirections.entryPoint.scheme=https
      # Docker provider via socket proxy
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.endpoint=tcp://proxy:2375
      # Wildcard TLS
      - --entrypoints.websecure.http.tls=true
      - --entrypoints.websecure.http.tls.certResolver=letsencrypt
      - --entrypoints.websecure.http.tls.domains[0].main=jmartins.dev
      - --entrypoints.websecure.http.tls.domains[0].sans=*.jmartins.dev
      - --log.level=INFO
    environment:
      - CF_DNS_API_TOKEN=[REDACTED]
    depends_on:
      pihole:
        condition: service_healthy
      proxy:
        condition: service_started
    restart: always
```

A few details worth calling out:

**DNS challenge for Let's Encrypt**: Since our services are only accessible through the WireGuard tunnel, the standard
HTTP-01 challenge won't work — Let's Encrypt can't reach our server over the public internet to validate ownership. We
use the DNS-01 challenge[^dns-challenge] with Cloudflare as the DNS provider instead. Traefik automatically creates the
necessary DNS TXT records to prove domain ownership and obtains a wildcard certificate for `*.jmartins.dev`.

**Wildcard certificate**: Rather than requesting individual certificates for each subdomain, a single wildcard
certificate covers the lot. Adding a new service is as simple as adding a Traefik label with the right `Host()` rule
— no new certificate needed, no rate limit concerns.

**HTTP to HTTPS redirect**: The `web` entrypoint on port 80 automatically redirects all traffic to `websecure` on port
443.

### Service Routing with Labels

Since Traefik uses `network_mode: service:wireguard`, it shares the WireGuard container's network namespace. This means
that any service _also_ sharing that network namespace (via `network_mode: service:wireguard`) is reachable from Traefik
at `localhost:<port>`. However, Traefik discovers services through Docker labels, and since these co-located services
don't have their own network identity from Docker's perspective, their routing labels need to go on the WireGuard
container:

```yaml
### LABELS ON THE WIREGUARD CONTAINER ###
    labels:
      - traefik.enable=true

      ## PiHole
      - traefik.http.routers.pihole.entrypoints=websecure
      - traefik.http.routers.pihole.rule=Host(`pihole.jmartins.dev`)
      - traefik.http.routers.pihole.service=pihole
      - traefik.http.services.pihole.loadbalancer.server.scheme=http
      - traefik.http.services.pihole.loadbalancer.server.port=${PIHOLE_WEBUI_PORT}

      ## Jellyfin
      - traefik.http.routers.jellyfin.entrypoints=websecure
      - traefik.http.routers.jellyfin.rule=Host(`jellyfin.jmartins.dev`)
      - traefik.http.routers.jellyfin.tls.certresolver=letsencrypt
      - traefik.http.routers.jellyfin.service=jellyfin
      - traefik.http.services.jellyfin.loadbalancer.server.scheme=http
      - traefik.http.services.jellyfin.loadbalancer.server.port=${JELLYFIN_WEBUI_PORT}
```

Each block defines a router (matching on hostname) and a service (pointing to the correct port). The pattern repeats
for every service you want to expose — add a `Host()` rule, point it at the right port, and Traefik handles the rest.
Services that have their _own_ Docker network (not using `network_mode: service:wireguard`) can define labels directly
on their own container definitions instead.

### Services Outside the Kill Switch

Not every service belongs behind the kill switch. Consider a notification service like ntfy[^ntfy] — its entire purpose
is to send push notifications to your devices. If the VPN connection drops and the kill switch activates, a
notification service sharing the WireGuard network would be blocked from reaching the internet along with everything
else. That's precisely the moment you _want_ a notification telling you that egress has stopped.

The solution is to give the service its own Docker network identity instead of sharing WireGuard's. Since it's not using
`network_mode: service:wireguard`, it has its own outbound route that bypasses the kill switch entirely. Traefik can
still route to it — the Docker provider discovers it by its own labels, and the WireGuard container's connection to the
default Docker network means Traefik can reach it over that network.

```yaml
### DOCKER-COMPOSE.YAML — NTFY SERVICE ###
  ntfy:
    image: binwiederhier/ntfy
    container_name: ntfy
    command:
      - serve
    environment:
      - TZ=${TZ}
      - NTFY_BASE_URL=https://ntfy.jmartins.dev
      - NTFY_AUTH_DEFAULT_ACCESS=deny-all
      - NTFY_BEHIND_PROXY=true
      - NTFY_ENABLE_LOGIN=true
    user: ${PUID}:${PGID}
    volumes:
      - ${CONFIG_DIR}/ntfy_cache:/var/lib/ntfy
      - ${CONFIG_DIR}/ntfy_config:/etc/ntfy
    healthcheck:
      test: ["CMD-SHELL", "wget -q --tries=1 http://localhost:80/v1/health -O - | grep -Eo '\"healthy\"\\s*:\\s*true' || exit 1"]
      interval: 60s
      timeout: 10s
      retries: 3
      start_period: 40s
    labels:
      - traefik.enable=true
      - traefik.http.routers.ntfy.entrypoints=websecure
      - traefik.http.routers.ntfy.rule=Host(`ntfy.jmartins.dev`)
      - traefik.http.routers.ntfy.tls.certresolver=letsencrypt
      - traefik.http.routers.ntfy.service=ntfy
      - traefik.http.services.ntfy.loadbalancer.server.scheme=http
      - traefik.http.services.ntfy.loadbalancer.server.port=80
    restart: always
```

Notice the difference: the Traefik labels are on the `ntfy` container itself rather than on the `wireguard` container.
From a remote client's perspective the experience is
identical — `ntfy.jmartins.dev` resolves to `10.0.2.1` via PiHole, Traefik routes it to the ntfy container over the
Docker network, and the response travels back through the tunnel. The only difference is what happens to ntfy's
_outbound_ traffic: it goes directly through the host's network rather than through Mullvad, so it can still deliver
notifications when the VPN is down.

This pattern applies to any service where continued outbound connectivity is more important than routing through the VPN
— monitoring, alerting, and dynamic DNS updaters are common examples.

## Putting It All Together

Now we're ready to build the full stack. Here's the complete `docker-compose.yaml` with the WireGuard client-server,
PiHole, Traefik, the Docker Socket Proxy, Jellyfin as an example service behind the kill switch, and ntfy as an example
service outside it:

```yaml
### DOCKER-COMPOSE.YAML ###
services:
  wireguard:
    image: lscr.io/linuxserver/wireguard:latest
    container_name: wireguard
    hostname: wireguard
    cap_add:
      - NET_ADMIN
    environment:
      - PUID=${PUID}
      - PGID=${PGID}
      - TZ=${TZ}
      - PEERS=laptop,phone
      - SERVERURL=wireguard.example.com
      - SERVERPORT=${WIREGUARD_PORT}
      - INTERNAL_SUBNET=10.0.2.0/24
      - PEERDNS=10.0.2.1
      - ALLOWEDIPS=0.0.0.0/0
      - LOG_CONFS=false
    healthcheck:
      test: ping -c 1 1.1.1.1 || exit 1
      interval: 2s
      start_period: 10s
      start_interval: 2s
      timeout: 5s
      retries: 3
    volumes:
      - ${CONFIG_DIR}/wireguard:/config
      - ${CONFIG_DIR}/wireguard_startup:/custom-cont-init.d:ro
    ports:
      - 80:80
      - 443:443
      - ${WIREGUARD_PORT}:${WIREGUARD_PORT}/udp
      - ${JELLYFIN_WEBUI_HTTP_PORT}:${JELLYFIN_WEBUI_HTTP_PORT}  # direct access for Jellyfin mobile apps
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
    networks:
      - default
      - internal
    restart: always
    labels:
      - traefik.enable=true
      ## PiHole
      - traefik.http.routers.pihole.entrypoints=websecure
      - traefik.http.routers.pihole.rule=Host(`pihole.jmartins.dev`)
      - traefik.http.routers.pihole.service=pihole
      - traefik.http.services.pihole.loadbalancer.server.scheme=http
      - traefik.http.services.pihole.loadbalancer.server.port=${PIHOLE_WEBUI_PORT}
      ## Traefik dashboard
      - traefik.http.routers.traefik.entrypoints=websecure
      - traefik.http.routers.traefik.rule=Host(`traefik.jmartins.dev`)
      - traefik.http.routers.traefik.tls.certresolver=letsencrypt
      - traefik.http.routers.traefik.service=api@internal
      ## Jellyfin
      - traefik.http.routers.jellyfin.entrypoints=websecure
      - traefik.http.routers.jellyfin.rule=Host(`jellyfin.jmartins.dev`)
      - traefik.http.routers.jellyfin.tls.certresolver=letsencrypt
      - traefik.http.routers.jellyfin.service=jellyfin
      - traefik.http.services.jellyfin.loadbalancer.server.scheme=http
      - traefik.http.services.jellyfin.loadbalancer.server.port=${JELLYFIN_WEBUI_HTTP_PORT}

  pihole:
    container_name: pihole
    image: pihole/pihole:latest
    network_mode: service:wireguard
    depends_on:
      wireguard:
        condition: service_healthy
    healthcheck:
      test: ping -c 1 google.com || exit 1
      interval: 2s
      start_period: 10s
      start_interval: 2s
      timeout: 5s
      retries: 3
    environment:
      TZ: ${TZ}
      FTLCONF_webserver_port: ${PIHOLE_WEBUI_PORT}
      FTLCONF_webserver_api_password: ${PIHOLE_PASSWORD}
      FTLCONF_dns_upstreams: '1.1.1.1'
      FTLCONF_dns_dnssec: true
      FTLCONF_dns_revServers: 'true,192.168.1.0/24,192.168.1.1,lan'
      FTLCONF_misc_dnsmasq_lines: "address=/jmartins.dev/10.0.2.1;server=/proxy/127.0.0.11"
    cap_add:
      - NET_ADMIN
    volumes:
      - ${CONFIG_DIR}/pihole/etc-pihole/:/etc/pihole/
      - ${CONFIG_DIR}/pihole/etc-dnsmasq.d/:/etc/dnsmasq.d/
    restart: always

  proxy:
    image: tecnativa/docker-socket-proxy
    container_name: proxy
    environment:
      - CONTAINERS=1
      - SERVICES=1
      - NETWORKS=1
      - TASKS=1
      - IMAGES=1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks:
      - internal
    restart: always

  traefik:
    image: traefik
    container_name: traefik
    network_mode: service:wireguard
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - ${CONFIG_DIR}/traefik/letsencrypt:/letsencrypt
    command:
      - --api.dashboard=true
      - --certificatesresolvers.letsencrypt.acme.dnschallenge=true
      - --certificatesresolvers.letsencrypt.acme.dnschallenge.provider=cloudflare
      - --certificatesresolvers.letsencrypt.acme.email=me@example.com
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --entrypoints.web.http.redirections.entryPoint.to=websecure
      - --entrypoints.web.http.redirections.entryPoint.scheme=https
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.endpoint=tcp://proxy:2375
      - --entrypoints.websecure.http.tls=true
      - --entrypoints.websecure.http.tls.certResolver=letsencrypt
      - --entrypoints.websecure.http.tls.domains[0].main=jmartins.dev
      - --entrypoints.websecure.http.tls.domains[0].sans=*.jmartins.dev
      - --log.level=INFO
    environment:
      - CF_DNS_API_TOKEN=[REDACTED]
    depends_on:
      pihole:
        condition: service_healthy
      proxy:
        condition: service_started
    restart: always

  jellyfin:
    image: lscr.io/linuxserver/jellyfin
    container_name: jellyfin
    network_mode: service:wireguard
    environment:
      - PUID=${PUID}
      - PGID=${PGID}
      - TZ=${TZ}
      - JELLYFIN_PublishedServerUrl=jellyfin.jmartins.dev
    volumes:
      - ${CONFIG_DIR}/jellyfin:/config
      - ${MOVIE_BACKUPS_DIR}:/data/movie_backups
    devices:
      - /dev/dri:/dev/dri
    depends_on:
      pihole:
        condition: service_healthy
    restart: always

  ntfy:
    image: binwiederhier/ntfy
    container_name: ntfy
    command:
      - serve
    environment:
      - TZ=${TZ}
      - NTFY_BASE_URL=https://ntfy.jmartins.dev
      - NTFY_AUTH_DEFAULT_ACCESS=deny-all
      - NTFY_BEHIND_PROXY=true
      - NTFY_ENABLE_LOGIN=true
    user: ${PUID}:${PGID}
    volumes:
      - ${CONFIG_DIR}/ntfy_cache:/var/lib/ntfy
      - ${CONFIG_DIR}/ntfy_config:/etc/ntfy
    healthcheck:
      test: ["CMD-SHELL", "wget -q --tries=1 http://localhost:80/v1/health -O - | grep -Eo '\"healthy\"\\s*:\\s*true' || exit 1"]
      interval: 60s
      timeout: 10s
      retries: 3
      start_period: 40s
    labels:
      - traefik.enable=true
      - traefik.http.routers.ntfy.entrypoints=websecure
      - traefik.http.routers.ntfy.rule=Host(`ntfy.jmartins.dev`)
      - traefik.http.routers.ntfy.tls.certresolver=letsencrypt
      - traefik.http.routers.ntfy.service=ntfy
      - traefik.http.services.ntfy.loadbalancer.server.scheme=http
      - traefik.http.services.ntfy.loadbalancer.server.port=80
    restart: always

networks:
  default:
    name: docker-stack-network
  internal:
    name: traefik-internal
    internal: true
```

The corresponding `.env` file:

```shell
### .ENV FILE ###

# ======== user ========
PUID=1000
PGID=1000
TZ=Australia/Sydney

# ======== directories ========
CONFIG_DIR=/home/jmartins/docker-stack/configs
MOVIE_BACKUPS_DIR=/mnt/media/movie_backups

# ======== network ========
WIREGUARD_PORT=51820

# ======== service ports ========
PIHOLE_WEBUI_PORT=9000
PIHOLE_PASSWORD=your_pihole_password
JELLYFIN_WEBUI_HTTP_PORT=8096
```

You'll notice that Jellyfin's HTTP port is exposed directly on the WireGuard container in addition to being routed
through Traefik on 443. This is for Jellyfin's mobile apps, which can connect directly over the tunnel using the raw
HTTP port without going through the reverse proxy.

Two Docker networks are at play here. The `default` network is where most services live. The `internal` network exists
solely for Traefik to communicate with the Docker Socket Proxy — its `internal: true` flag prevents any container on it
from accessing the internet, limiting the blast radius if the proxy were compromised. The WireGuard container connects
to both networks, bridging them. Docker handles IP assignment and DNS resolution for container hostnames automatically,
so services can reference each other by name (e.g. Traefik reaches the proxy at `tcp://proxy:2375`) without needing
hardcoded addresses.

## Connecting from the Outside

With the stack running, it's time to connect a device. The Linuxserver.io WireGuard image generates peer configurations
in `/config/peer_laptop/`, `/config/peer_phone/`, and so on. Each folder contains a `peer_<name>.conf` file and a QR
code PNG that you can scan with the WireGuard mobile app.

A generated peer configuration looks something like this:

```ini
[Interface]
Address = 10.0.2.2/32
PrivateKey = [REDACTED]
ListenPort = 51820
DNS = 10.0.2.1

[Peer]
PublicKey = [REDACTED]
PresharedKey = [REDACTED]
Endpoint = wireguard.example.com:51820
AllowedIPs = 0.0.0.0/0
```

The key fields: `DNS = 10.0.2.1` points to PiHole on the tunnel, and `AllowedIPs = 0.0.0.0/0` routes all traffic
through the VPN. Import this on your device, connect, and let's verify everything works.

From the connected laptop:

```shell
$ curl https://am.i.mullvad.net/connected
You are connected to Mullvad (server au14-wireguard). Your IP address is 89.44.10.183

$ dig +short jellyfin.jmartins.dev @10.0.2.1
10.0.2.1

$ curl -sI https://jellyfin.jmartins.dev | head -5
HTTP/2 200
content-type: text/html; charset=utf-8
x-response-time-ms: 12
server: Kestrel
date: Sun, 23 Feb 2026 10:00:00 GMT
```

The first command confirms our traffic exits through Mullvad — same as in the previous article, but now from a remote
device rather than from inside the container. The second shows that PiHole resolves `jellyfin.jmartins.dev` to
`10.0.2.1`, the WireGuard tunnel address. The third confirms Traefik is routing the HTTPS request to Jellyfin and
serving a valid certificate.

We can also verify the WireGuard container is running both interfaces by `exec`_ing_ into it:

```shell
root@wireguard:/# wg show
interface: wg0
  public key: [REDACTED]
  private key: (hidden)
  listening port: 51820
  fwmark: 0xca6c

peer: [REDACTED]
  endpoint: 203.0.113.45:51820
  allowed ips: 10.0.2.2/32
  latest handshake: 42 seconds ago
  transfer: 156.78 MiB received, 1.23 GiB sent

interface: wg1
  public key: [REDACTED]
  private key: (hidden)
  listening port: 41983
  fwmark: 0xca6c

peer: [REDACTED]
  endpoint: 89.44.10.178:51820
  allowed ips: 0.0.0.0/0
  latest handshake: 1 minute, 12 seconds ago
  transfer: 2.45 GiB received, 892.34 MiB sent
```

`wg0` is the server interface with our laptop connected as a peer. `wg1` is the Mullvad client tunnel. Both are up,
both are transferring data, and the `fwmark` on both matches our kill switch exemption value of `0xca6c`.

## Conclusion

What started in the [previous article](/posts/wireguard-docker-killswitch) as a single VPN client container with a kill
switch has evolved into a proper remote access stack. The WireGuard container now sits at the centre of the network,
simultaneously serving as a VPN client to Mullvad and a VPN server for remote devices. PiHole provides ad-blocking DNS
for every connected device, with a dnsmasq trick that routes service subdomains back through the WireGuard tunnel to
Traefik. Traefik handles HTTPS termination with a Let's Encrypt wildcard certificate obtained via DNS challenge, routing
requests to the correct service without any of them being directly exposed to the internet.

The stack fails closed — if the Mullvad connection drops, the kill switch blocks all outbound traffic for services
sharing the WireGuard network. If the WireGuard configuration fails to parse, the iptables rules from the startup
script are already in place. Services that need to maintain outbound connectivity regardless of VPN state, such as
notification and monitoring services, can be placed on their own Docker network to bypass the kill switch while
remaining accessible to remote clients through Traefik.

Every device connecting through the VPN gets ad blocking, encrypted DNS, and access to self-hosted services, all
through a single WireGuard connection. Adding a new service is a matter of defining the container with
`network_mode: service:wireguard` (or its own network, depending on the use case), adding Traefik labels for routing,
and exposing the port on the WireGuard container. PiHole's wildcard dnsmasq rule handles DNS automatically. No firewall
changes, no certificate requests, no client-side configuration.

[^linuxserver-wireguard]: [Linuxserver.io WireGuard guide](https://www.linuxserver.io/blog/routing-docker-host-and-container-traffic-through-wireguard)
[^network-mode]: [Docker Compose `network_mode` docs](https://docs.docker.com/reference/compose-file/services/#network_mode)
[^custom-cont-init]: [Linuxserver.io Custom Scripts](https://www.linuxserver.io/blog/2019-09-14-customizing-our-containers)
[^rfc1918]: [RFC 1918 — Address Allocation for Private Internets](https://www.rfc-editor.org/rfc/rfc1918)
[^pihole]: [Pi-hole — Network-wide ad blocking](https://pi-hole.net/)
[^traefik]: [Traefik — Cloud Native Application Proxy](https://traefik.io/traefik/)
[^dns-challenge]: [Let's Encrypt DNS-01 Challenge](https://letsencrypt.org/docs/challenge-types/#dns-01-challenge)
[^docker-socket-proxy]: [Tecnativa Docker Socket Proxy](https://github.com/Tecnativa/docker-socket-proxy)
[^ntfy]: [ntfy — Push notifications](https://ntfy.sh/)

---

## Changelog

- **2026-02-26**: Updated the startup script to automatically patch `wg0.conf` with custom `PostUp` and `FwMark`
  directives, eliminating the need to manually edit the generated config. Added `eth0` masquerade rule to the server's
  `PostUp` for LAN access from peers. Added tolerant route additions for container restarts. Added conditional DNS
  forwarding (`server=/proxy/127.0.0.11`) to PiHole's dnsmasq configuration so Traefik can resolve the Docker Socket
  Proxy hostname after `wg-quick` overwrites `/etc/resolv.conf`. Added Traefik dashboard labels to the full compose
  example.
- **2026-02-23**: Initial publication.
