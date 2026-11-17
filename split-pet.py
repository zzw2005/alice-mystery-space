#!/usr/bin/env python3
"""Split pet.cs into partial-class files by method segments.
Pure moves: no line inside a segment is altered. Asserts segment starts
match the expected member and that braces balance within each segment."""
import sys, os

SRC = os.path.expanduser("~/workspace/butler-build/AliceButler/pet.cs")
lines = open(SRC, encoding="utf-8").read().split("\n")
# lines[i] is source line i+1; file ends with trailing newline -> last elem ''
assert lines[-1] == ""
lines = lines[:-1]
print("total lines:", len(lines))

def L(n): return lines[n - 1]

# segment: (start_line, end_line_exclusive, expect_token_at_start, dest)
SEGMENTS = [
    (166, 187, "SpawnHearts", "pet.Physics.cs"),
    (321, 368, "ReplayHistory", "pet.Bridge.cs"),
    (380, 523, "EnsureClip", "pet.Clips.cs"),
    (523, 706, "CurrentBitmap", "pet.Render.cs"),
    (706, 951, "PetMouseDown", "pet.Physics.cs"),
    (951, 1592, "BuildBubble", "pet.ChatUi.cs"),
    (1592, 1611, "SendChat", "pet.Bridge.cs"),
    (1611, 1743, "BuildTray", "pet.Presence.cs"),
    (1743, 1789, "PollOutbox", "pet.Bridge.cs"),
]

EFFECTIVE = []
for start, end, token, dest in SEGMENTS:
    assert token in L(start), f"line {start} expected {token}, got: {L(start)!r}"
    # trim trailing blank / section-comment lines: they belong to what follows
    e = end
    while e > start and (L(e - 1).strip() == "" or L(e - 1).strip().startswith("//")):
        e -= 1
    EFFECTIVE.append((start, e, token, dest))
    seg = lines[start - 1:e - 1]
    bal = sum(s.count("{") - s.count("}") for s in seg)
    assert bal == 0, f"segment {token} brace balance {bal}"
    tail = [s for s in seg if s.strip()]
    assert tail[-1] == "        }", f"segment {token} ends with {tail[-1]!r}"
SEGMENTS = EFFECTIVE
print("segment asserts ok; tail check:")
print("1789:", repr(L(1789)), "| 1790:", repr(L(1790)))

header = []
for s in lines:
    if s.startswith("namespace "):
        break
    header.append(s)

removed = set()
by_dest = {}
for start, end, token, dest in SEGMENTS:
    by_dest.setdefault(dest, []).extend(lines[start - 1:end - 1])
    removed.update(range(start, end))

outdir = os.path.dirname(SRC)
for dest, seg in by_dest.items():
    body = header + ["namespace AlicePet", "{", "    public partial class PetForm", "    {"]
    body += seg
    body += ["    }", "}", ""]
    with open(os.path.join(outdir, dest), "w", encoding="utf-8") as fh:
        fh.write("\n".join(body))
    print("wrote", dest, len(seg), "segment lines")

core = [s for i, s in enumerate(lines, 1) if i not in removed]
core = [s.replace("    public class PetForm : Form", "    public partial class PetForm : Form") for s in core]
with open(SRC, "w", encoding="utf-8") as fh:
    fh.write("\n".join(core) + "\n")
print("core pet.cs now", len(core), "lines")
