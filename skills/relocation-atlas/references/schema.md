# Layer CSV schema

`name,address,layer,kind,tag,label,lat,lon,hours,note,source,confidence,rank`

| Column | Required | Notes |
|---|---|---|
| name | yes | As the place names itself |
| address | yes* | Street address; leave lat/lon empty and run `atlas.py geocode` to fill them |
| layer | yes | Display group; give it a color in `city.json` `layer_colors` |
| kind | yes | `daily` or `weekly` |
| tag | yes | Interest tag from layers.md |
| label | no | Short uppercase descriptor, e.g. `SPECIALTY COFFEE · $$` |
| lat, lon | yes | Decimal degrees, inside `city.json` bounds |
| hours | no | Only if a current source states them |
| note | no | One or two plain sentences: why it's here, what to know |
| source | yes | URL of the page the row came from |
| confidence | yes | `verified` (official page current this year) · `likely` (two sources agree) · `verify` (single or old source) · `unverified` |
| rank | no | Position in a ranked list (1 = best) |
