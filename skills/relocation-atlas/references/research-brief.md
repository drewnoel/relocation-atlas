# Research brief template (one subagent per layer group)

Paste this, filled in, as the subagent prompt.

> Research the **{N} best {layer}** for someone living near **{base name} ({lat}, {lon})** in **{city}**, who cares
> about **{the person's own words about this interest}**. Prefer places within {walk minutes} minutes on foot; include
> up to {k} farther standouts.
>
> Write `cities/{slug}/layers/{topic}.csv` with exactly these columns:
> `name,address,layer,kind,tag,label,lat,lon,hours,note,source,confidence,rank`
> (layer = "{Layer display name}", kind = {daily|weekly}, tag = {tag}).
>
> Rules: one current source URL per row; confidence per schema.md; drop anything a source says has closed;
> never invent an address or hours (leave blank, set confidence `verify`); paraphrase notes in your own words;
> read public pages normally, no scraping tools, no logged-in pages; leave lat/lon blank if unsure and say so.
> Exclude anything matching: {exclude_terms}.
>
> Report back: row count, how many verified / likely / verify, closures you caught, and anything you were unsure of.
