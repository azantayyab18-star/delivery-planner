"""Deleting a route (also one underway), and the optional customer signature as proof of delivery."""
from __future__ import annotations

from app.db import db

from .test_api import rider
from .test_v2 import JPEG, TODAY, key, route_with_stops

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


async def deliver_first(client, auth, route: dict) -> str:
    stop = route["stops"][0]["delivery"]["id"]
    await client.post(f"/api/v2/stops/{stop}/events", headers={**auth, **key()}, json={"type": "deliver"})
    return stop


async def test_deleting_a_route_underway_can_keep_its_open_stops(client):
    _, auth = await rider(client, "delete-keep@example.com")
    route = await route_with_stops(client, auth, 4)
    done = await deliver_first(client, auth, route)

    res = await client.delete(f"/api/v1/routes/{route['id']}", headers=auth, params={"keepStops": "true"})
    assert res.status_code == 200, res.text
    assert res.json()["data"] == {"deleted": True, "stopsKept": 3, "stopsDeleted": 0}
    assert (await client.get(f"/api/v1/routes/{route['id']}", headers=auth)).status_code == 404
    # The three open stops are unplanned on the same day; the delivered one stays delivered (History).
    left = await db.delivery.find_many(where={"id": {"in": [s["delivery"]["id"] for s in route["stops"]]}})
    by_id = {d.id: d for d in left}
    assert by_id[done].status == "delivered" and by_id[done].routeId is None
    assert all(d.status == "pending" and d.routeId is None and d.stopOrder is None and d.serviceDate == TODAY for i, d in by_id.items() if i != done)
    # They can go on a new route straight away (nothing is underway now).
    again = await client.post("/api/v1/routes/build", headers=auth, json={"deliveryIds": [i for i in by_id if i != done], "date": TODAY})
    assert again.status_code == 201, again.text


async def test_deleting_a_route_can_delete_its_open_stops_too(client):
    body, auth = await rider(client, "delete-all@example.com")
    route = await route_with_stops(client, auth, 3, start=False)
    res = await client.delete(f"/api/v1/routes/{route['id']}", headers=auth, params={"keepStops": "false"})
    assert res.json()["data"] == {"deleted": True, "stopsKept": 0, "stopsDeleted": 3}
    assert not await db.delivery.count(where={"riderId": body["user"]["id"]})
    # Copies are kept, so a mistake can be undone by support.
    assert await db.deleteddelivery.count(where={"riderId": body["user"]["id"], "reason": "route_deleted"}) == 3


async def test_only_the_riders_own_route_can_be_deleted(client):
    _, auth = await rider(client, "delete-owner@example.com")
    _, stranger = await rider(client, "delete-stranger@example.com")
    route = await route_with_stops(client, auth, 2, start=False)
    assert (await client.delete(f"/api/v1/routes/{route['id']}", headers=stranger)).status_code == 404
    assert (await client.get(f"/api/v1/routes/{route['id']}", headers=auth)).status_code == 200


async def test_a_signature_is_optional_proof_next_to_the_photo(client):
    _, auth = await rider(client, "signature@example.com")
    route = await route_with_stops(client, auth, 2)
    stop = await deliver_first(client, auth, route)

    signed = await client.post("/api/v2/uploads/proof", params={"stopId": stop, "kind": "signature"}, headers={**auth, **key()},
                               files={"photo": ("s.png", PNG, "image/png")})
    assert signed.status_code == 200, signed.text
    proof = signed.json()["data"]["proof"]
    assert proof["photoUrl"] is None and proof["signatureUrl"] and (await client.get(proof["signatureUrl"])).content == PNG

    photo = await client.post("/api/v2/uploads/proof", params={"stopId": stop}, headers={**auth, **key()}, files={"photo": ("p.jpg", JPEG, "image/jpeg")})
    proof = photo.json()["data"]["proof"]
    assert proof["photoUrl"] and proof["signatureUrl"], "the photo does not replace the signature"

    # A signature is a PNG drawn on the phone: a JPEG is refused.
    jpeg = await client.post("/api/v2/uploads/proof", params={"stopId": stop, "kind": "signature"}, headers={**auth, **key()},
                             files={"photo": ("s.jpg", JPEG, "image/jpeg")})
    assert jpeg.status_code == 415
