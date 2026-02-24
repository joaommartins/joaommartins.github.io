# jmartins.dev

Personal blog built with [Hugo](https://gohugo.io/) and the [Blowfish](https://blowfish.page/) theme, deployed to GitHub Pages.

## Prerequisites

- [Hugo](https://gohugo.io/installation/) (latest)
- Git (with submodule support)

## Local Development

Clone with submodules (needed for the theme):

```sh
git clone --recurse-submodules https://github.com/joaommartins/joaommartins.github.io.git
cd joaommartins.github.io
```

Start the dev server:

```sh
hugo server -D
```

The `-D` flag renders draft posts. The site will be available at `http://localhost:1313/`.

## Writing a New Article

### 1. Create the post

**Option A** &mdash; Using Hugo's scaffolding:

```sh
hugo new content posts/my-new-post/index.md
```

**Option B** &mdash; Manually create a directory under `content/posts/`:

```
content/posts/my-new-post/
  index.md
  feature.png   # optional hero/social image
```

### 2. Fill in the frontmatter

```yaml
---
title: "My New Post"
date: "2026-02-24T10:00:00.000Z"
draft: true
slug: "my-new-post"
category: "Category"
tags:
  - "Tag1"
  - "Tag2"
description: "A short summary of the post."
socialImage: "/path/to/image.png"
---
```

Key fields:

| Field         | Purpose                                              |
|---------------|------------------------------------------------------|
| `draft`       | Set to `true` while writing, `false` when ready      |
| `slug`        | URL path &mdash; the post will live at `/posts/slug/` |
| `date`        | ISO 8601 timestamp                                   |
| `description` | Shown in previews and social cards                   |

### 3. Preview locally

```sh
hugo server -D
```

### 4. Publish

1. Set `draft: false` in the post's frontmatter.
2. Commit and push to `main`:
   ```sh
   git add content/posts/my-new-post/
   git commit -S -m "feat: add my-new-post article"
   git push
   ```
3. GitHub Actions will build the site with `hugo --minify` and deploy to the `gh-pages` branch automatically.
4. The post will be live at **https://jmartins.dev/posts/my-new-post/**.

## Project Structure

```
config/_default/   # Hugo & theme configuration
content/
  posts/           # Blog articles
  about.md         # About page
themes/blowfish/   # Theme (git submodule)
assets/            # Static assets (images, css)
archetypes/        # Templates for hugo new
.github/workflows/ # CI/CD pipeline
```

## Deployment

Handled automatically by GitHub Actions on every push to `main`. The workflow:

1. Checks out the repo with submodules.
2. Builds with `hugo --minify`.
3. Deploys `./public` to the `gh-pages` branch.
4. GitHub Pages serves the site at **jmartins.dev**.
