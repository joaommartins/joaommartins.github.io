from staticjinja import Site
import json
from pathlib import Path

from data_reader import parse_jsons


if __name__ == "__main__":
    site = Site.make_site(env_globals=parse_jsons('json_data'))
    # enable automatic reloading
    site.render(use_reloader=True)
