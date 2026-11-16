"""Live, read-only smoke tests against Balad's public map services.

This diagnostic deliberately tests only map APIs. It never builds Android apps or APKs.
"""
from __future__ import annotations

import asyncio
import json
import sys

from balad_mcp.maps import bl_reverse_geocode, bl_route, bl_search

# Gonbad-e Kavus city centre and a road destination in Gorgan.
GONBAD = (37.25, 55.17)
GORGAN = (36.8456, 54.4393)


async def run_test(name, call, validate):
    try:
        result = await asyncio.wait_for(call, timeout=55)
        validate(result)
        print(json.dumps({"test": name, "status": "PASS", "result": result}, ensure_ascii=False))
        return True
    except Exception as exc:  # report each API independently
        message = " ".join(str(exc).split())[:500]
        print(json.dumps({"test": name, "status": "FAIL", "error": message}, ensure_ascii=False))
        return False


async def main():
    outcomes = []

    outcomes.append(await run_test(
        "search_gonbad",
        bl_search("گنبد کاووس", lat=GONBAD[0], lng=GONBAD[1], limit=5),
        lambda r: (_ for _ in ()).throw(ValueError("No search results returned"))
        if not r.get("results") else None,
    ))

    outcomes.append(await run_test(
        "reverse_geocoding_gonbad",
        bl_reverse_geocode(lat=GONBAD[0], lng=GONBAD[1]),
        lambda r: (_ for _ in ()).throw(ValueError("No Persian address returned"))
        if not (r.get("address") or "").strip() else None,
    ))

    outcomes.append(await run_test(
        "driving_route_gonbad_to_gorgan",
        bl_route(
            from_lat=GONBAD[0], from_lng=GONBAD[1],
            to_lat=GORGAN[0], to_lng=GORGAN[1],
        ),
        lambda r: (_ for _ in ()).throw(ValueError("No usable driving route returned"))
        if not r.get("routes") or not any((x.get("km") or 0) > 0 and (x.get("minutes") or 0) > 0 for x in r["routes"])
        else None,
    ))

    passed = sum(outcomes)
    total = len(outcomes)
    print(json.dumps({"summary": {"passed": passed, "total": total, "failed": total - passed}}, ensure_ascii=False))
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
