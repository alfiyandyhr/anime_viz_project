"""Export annual Top 10 AniList rankings for the static GitHub Pages site."""
import json
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "backend"))
from anilist_service import DashboardDataError
from story_service import StoryService


def main():
    print("Fetching annual Top 10 rankings from 1963 to the current year…", flush=True)
    try:
        payload = StoryService().get_story(force_refresh=True)
    except DashboardDataError as error:
        print(f"Could not refresh Story: {error}", file=sys.stderr)
        return 1
    if not payload["meta"]["complete"]:
        print("Refresh incomplete; retaining the existing static snapshot. Run again later.", file=sys.stderr)
        return 1
    output = PROJECT_ROOT / "story.json"
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(output)
    print(f"Wrote {payload['meta']['sample_size']} titles across {len(payload['years'])} years to {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
