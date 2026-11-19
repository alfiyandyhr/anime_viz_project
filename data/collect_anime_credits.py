"""Collect original-creator credits for fixed AniList media IDs."""
from collect_anime import ANILIST_URL
from common import CollectionError

MEDIA_BATCH_SIZE = 20
CREDIT_PAGE_SIZE = 25
CREATOR_ROLES = {"original creator", "original story", "original work"}

CREATOR_QUERY = f"""
query CatalogueCreators($ids: [Int]!, $size: Int!, $page: Int!) {{
  Page(page: 1, perPage: $size) {{
    media(id_in: $ids, type: ANIME, sort: [ID]) {{
      id
      staff(page: $page, perPage: {CREDIT_PAGE_SIZE}, sort: [ID]) {{
        pageInfo {{ hasNextPage }}
        edges {{ role node {{ id name {{ full native }} image {{ medium }} siteUrl }} }}
      }}
    }}
  }}
}}
"""


def add_creators(people, edges):
    for edge in edges:
        role = " ".join((edge.get("role") or "").split())
        if role.casefold() not in CREATOR_ROLES:
            continue
        node = edge.get("node") or {}
        person_id = node.get("id")
        names = node.get("name") or {}
        name = (names.get("full") or names.get("native") or "").strip()
        if type(person_id) is not int or person_id < 1 or not name:
            continue
        creator = people.setdefault(person_id, {
            "id": str(person_id), "name": name, "image": (node.get("image") or {}).get("medium"),
            "site_url": node.get("siteUrl"), "roles": [],
        })
        if role not in creator["roles"]:
            creator["roles"].append(role)


def collect_anime_creators(client, anime_ids):
    collected = {anime_id: {} for anime_id in anime_ids}
    pending = anime_ids
    page = 1
    while pending and page <= 500:
        next_page = []
        print(f"AniList: fetching staff page {page} for {len(pending)} anime", flush=True)
        for start in range(0, len(pending), MEDIA_BATCH_SIZE):
            batch = pending[start:start + MEDIA_BATCH_SIZE]
            payload = client.request(ANILIST_URL, payload={"query": CREATOR_QUERY, "variables": {
                "ids": batch, "size": len(batch), "page": page,
            }})
            media = ((payload.get("data") or {}).get("Page") or {}).get("media")
            if not isinstance(media, list) or any(not isinstance(row, dict) for row in media):
                raise CollectionError(f"AniList returned an invalid media batch for staff page {page}.")
            by_id = {row.get("id"): row for row in media}
            if len(media) != len(batch) or set(by_id) != set(batch):
                raise CollectionError(f"AniList returned different media IDs for staff page {page}. "
                                      f"Requested {batch}, received {list(by_id)}.")
            for anime_id in batch:
                result = by_id[anime_id].get("staff") or {}
                edges = result.get("edges")
                has_next = (result.get("pageInfo") or {}).get("hasNextPage")
                if not isinstance(edges, list) or type(has_next) is not bool or (has_next and not edges):
                    raise CollectionError(f"AniList returned an invalid staff page {page} for anime {anime_id}.")
                add_creators(collected[anime_id], (edge for edge in edges if edge))
                if has_next:
                    next_page.append(anime_id)
        pending = next_page
        page += 1
    if pending:
        raise CollectionError("AniList reached the pagination limit for staff credits.")
    return {
        str(anime_id): {"original_creators": sorted(people.values(), key=lambda person: (
            person["name"].casefold(), person["id"],
        ))}
        for anime_id, people in collected.items()
    }
