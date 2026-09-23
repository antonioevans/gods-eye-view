"""Extract mapped pedestrian ways and building footprints for the Citi Field demo.

Usage: python3 stadium/build_osm_snapshot.py [map.xml]
"""

import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

SOURCE = "https://api.openstreetmap.org/api/0.6/map?bbox=-73.851,40.754,-73.842,40.759"
ROOT = Path(__file__).resolve().parent
if len(sys.argv) > 1:
    raw = Path(sys.argv[1]).read_bytes()
else:
    request = urllib.request.Request(SOURCE, headers={"User-Agent": "NobleCitiFieldDemo/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        raw = response.read()

document = ET.fromstring(raw)
all_nodes = {node.attrib["id"]: [float(node.attrib["lon"]), float(node.attrib["lat"])] for node in document.findall("node")}
ways = []
buildings = []
used_nodes = set()
for way in document.findall("way"):
    tags = {tag.attrib["k"]: tag.attrib["v"] for tag in way.findall("tag")}
    refs = [node.attrib["ref"] for node in way.findall("nd")]
    pedestrian = tags.get("highway") in {"footway", "path", "pedestrian", "steps"} and tags.get("area") != "yes"
    parking_aisle = tags.get("highway") == "service" and tags.get("service") == "parking_aisle" and tags.get("access") != "private"
    if (pedestrian or parking_aisle) and tags.get("foot") != "no" and len(refs) > 1:
        ways.append({"id": way.attrib["id"], "nodes": refs, "kind": "parking_aisle" if parking_aisle else tags["highway"], "detail": tags.get("footway", ""), "name": tags.get("name", "")})
        used_nodes.update(refs)
    if ("building" in tags or "building:part" in tags or tags.get("leisure") == "stadium") and len(refs) > 3:
        if not all(ref in all_nodes for ref in refs):
            continue
        height = None
        try:
            height = float(tags["height"].split()[0]) if "height" in tags else None
        except ValueError:
            pass
        buildings.append({"id": way.attrib["id"], "kind": tags.get("building", tags.get("leisure", tags.get("building:part", ""))), "name": tags.get("name", ""), "height": height, "coordinates": [all_nodes[ref] for ref in refs]})

snapshot = {
    "source": SOURCE,
    "credit": "© OpenStreetMap contributors, ODbL 1.0",
    "nodes": {ref: all_nodes[ref] for ref in sorted(used_nodes) if ref in all_nodes},
    "ways": ways,
    "buildings": buildings,
}
target = ROOT / "data" / "citi-osm.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(snapshot, separators=(",", ":")) + "\n")
print(f"Saved {len(ways)} pedestrian ways, {len(snapshot['nodes'])} nodes, and {len(buildings)} footprints to {target}")
