"""
Fetch fresh data from AniList and write it to data.json.

Usage:
    python data/refresh_data.py

Then commit and push data.json to update the GitHub Pages site.
"""

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from anilist_service import AniListService, DashboardDataError

OUTPUT = PROJECT_ROOT / "data.json"


def main():
    print("Fetching data from AniList…")
    service = AniListService()

    try:
        dashboard = service.get_dashboard(force_refresh=True)
    except DashboardDataError as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)

    with OUTPUT.open("w", encoding="utf-8") as f:
        json.dump(dashboard, f, ensure_ascii=False, indent=2)

    count = len(dashboard.get("anime", []))
    generated = dashboard.get("meta", {}).get("generated_at", "unknown")
    print(f"Done. {count} anime written to {OUTPUT}")
    print(f"Generated at: {generated}")
    print()
    print("Next steps:")
    print("  git add data.json")
    print('  git commit -m "Refresh anime data"')
    print("  git push")


if __name__ == "__main__":
    main()
