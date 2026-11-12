---
'pixi-marrow': patch
---

Fixed: a display object whose asset was destroyed threw a `TypeError` from Pixi's shared ticker, which then stopped for every skeleton of the page. Its `update` now does nothing, and `autoUpdate` turns off. Destroy the display objects of an asset before the asset, as before.
