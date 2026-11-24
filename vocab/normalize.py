"""Must stay byte-compatible with normalizeKey() in apps-script/Code.gs.

Server re-normalizes everything it receives, so this copy is only used for
local preview and tests.
"""

import re
import unicodedata

_EDGE = ".,;:!?()[]{}\"'"


def normalize_key(text):
    s = unicodedata.normalize("NFKC", str(text or ""))
    s = s.replace("\u2018", "'").replace("\u2019", "'").replace("\u201b", "'")
    s = s.replace("\u201c", '"').replace("\u201d", '"')
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s.strip(_EDGE)
