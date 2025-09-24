from pathlib import Path
import re

path = Path('embyClient.js')
text = path.read_text(encoding='utf-8')

pattern = re.compile(r"async function buildFallbackSeriesVideos\(seriesItem, config\) \{.*?\n\}\n\n", re.DOTALL)
match = pattern.search(text)
if not match:
    raise SystemExit('buildFallbackSeriesVideos block not found')

new_block = """async function buildFallbackSeriesVideos(seriesItem, config) {
    const params = {
        ParentId: seriesItem.Id,
        IncludeItemTypes: Array.from(SERIES_CHILD_ITEM_TYPES).join(','),
        Fields: 'Name,IndexNumber,ParentIndexNumber,Id,Overview,PremiereDate,ImageTags,SortName',
        SortBy: 'ParentIndexNumber,IndexNumber,SortName',
        SortOrder: 'Ascending',
        Recursive: true,
        UserId: config.userId,
        Limit: 3000,
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary'
    };

    const data = await makeEmbyApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, params, config);
    if (!data?.Items?.length) return [];

    let fallbackCounter = 1;
    return data.Items
        .filter(child => child && SERIES_CHILD_ITEM_TYPES.has(child.Type))
        .map(child => {
            const fallbackId = buildFallbackMetaId(EMBY_ID_KINDS.EPISODE, child.Id);
            if (!fallbackId) return null;

            const orderIndex = fallbackCounter++;
            const seasonNumber = typeof child.ParentIndexNumber === 'number' ? child.ParentIndexNumber : 1;
            const detectedEpisode = typeof child.IndexNumber === 'number' ? child.IndexNumber : orderIndex;

            const video = {
                id: fallbackId,
                title: child.Name || `Episode ${detectedEpisode}`,
                season: seasonNumber,
                episode: detectedEpisode
            };

            if (child.Overview) video.overview = child.Overview;
            if (child.PremiereDate) video.released = child.PremiereDate;

            const thumb = buildPrimaryImageUrl(child, config);
            if (thumb) video.thumbnail = thumb;

            return video;
        })
        .filter(Boolean)
        .sort((a, b) => {
            const seasonDiff = (a.season ?? 0) - (b.season ?? 0);
            if (seasonDiff !== 0) return seasonDiff;
            return (a.episode ?? 0) - (b.episode ?? 0);
        });
}

"""

text = text[:match.start()] + new_block + text[match.end():]

folder_block_pattern = re.compile(r"    const allowedTypes = new Set\(stremioType === 'series' \? SERIES_ITEM_TYPES : MOVIE_ITEM_TYPES\);\n    const visitedFolders = new Set\(\);\n    const expandedItems = \[];\n    const queue = Array\.isArray\(data\.Items\) \? \[...data\.Items] : \[];\n\n    while \(queue\.length\) \{\n        const current = queue\.shift\(\);\n        if \(!current\) continue;\n\n        if \(stremioType === 'series' && current\.Type === 'Folder'\) \{\n            if \(visitedFolders\.has\(current\.Id\)\) continue;\n            visitedFolders\.add\(current\.Id\);\n            const childParams = \{\n                ParentId: current\.Id,\n                IncludeItemTypes: SERIES_ITEM_TYPES\.join\(','\),\n                Fields: 'ProviderIds,Name,Overview,ProductionYear,ImageTags,BackdropImageTags,PremiereDate',\n                ImageTypeLimit: 2,\n                EnableImageTypes: 'Primary,Backdrop',\n                Recursive: true,\n                UserId: config\.userId,\n                Limit: DEFAULT_CATALOG_LIMIT\n            \};\n            const childData = await makeEmbyApiRequest\(`\$\{config.serverUrl}/Users/\$\{config.userId}/Items`, childParams, config\);\n            if \(childData\?\.Items\?\.length\) queue\.push\(...childData\.Items\);\n            continue;\n        \}\n\n        if \(allowedTypes\.has\(current\.Type\)\) \{\n            expandedItems\.push\(current\);\n        \}\n    \}\n\n    if \(!expandedItems\.length\) return \[];\n\n    const metas = await Promise\.all\(\n        expandedItems\.map\(item => mapEmbyItemToMeta\(item, stremioType, config\)\)\n    \);\n\n    return metas\.filter\(Boolean\);"", re.DOTALL)
block_match = folder_block_pattern.search(text)
if not block_match:
    raise SystemExit('folder expansion block not found')

new_folder_block = """    const allowedTypes = new Set(stremioType === 'series' ? SERIES_ITEM_TYPES : MOVIE_ITEM_TYPES);
    const visitedFolders = new Set();
    const expandedItems = [];
    const queue = Array.isArray(data.Items) ? [...data.Items] : [];

    while (queue.length) {
        const current = queue.shift();
        if (!current) continue;

        if (stremioType === 'series' && current.Type === 'Folder') {
            if (visitedFolders.has(current.Id)) continue;
            visitedFolders.add(current.Id);
            const childParams = {
                ParentId: current.Id,
                IncludeItemTypes: SERIES_ITEM_TYPES.join(','),
                Fields: 'ProviderIds,Name,Overview,ProductionYear,ImageTags,BackdropImageTags,PremiereDate',
                ImageTypeLimit: 2,
                EnableImageTypes: 'Primary,Backdrop',
                Recursive: true,
                UserId: config.userId,
                Limit: DEFAULT_CATALOG_LIMIT
            };
            const childData = await makeEmbyApiRequest(`${config.serverUrl}/Users/${config.userId}/Items`, childParams, config);
            const childItems = Array.isArray(childData?.Items) ? childData.Items : [];
            let pushedChild = false;
            for (const child of childItems) {
                if (!child) continue;
                if (child.Type === 'Folder' && !visitedFolders.has(child.Id)) {
                    queue.push(child);
                    continue;
                }
                if (allowedTypes.has(child.Type)) {
                    queue.push(child);
                    pushedChild = true;
                }
            }
            if (!pushedChild) {
                expandedItems.push(current);
            }
            continue;
        }

        if (allowedTypes.has(current.Type)) {
            expandedItems.push(current);
        }
    }

    if (!expandedItems.length) return [];

    const metas = await Promise.all(
        expandedItems.map(item => mapEmbyItemToMeta(item, stremioType, config))
    );

    return metas.filter(Boolean);"""

text = text[:block_match.start()] + new_folder_block + text[block_match.end():]

path.write_text(text, encoding='utf-8')
