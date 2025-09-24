const fs = require('fs');
const path = 'embyClient.js';
let data = fs.readFileSync(path, 'utf8');

function replaceFunction(source, signature, replacement) {
  const start = source.indexOf(signature);
  if (start === -1) {
    throw new Error(Signature not found: );
  }
  const braceStart = source.indexOf('{', start);
  if (braceStart === -1) {
    throw new Error(Opening brace not found for );
  }
  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (depth !== 0) {
    throw new Error(Did not find matching closing brace for );
  }
  return source.slice(0, start) + replacement + source.slice(end + 1);
}

const newBuildFallback = sync function buildFallbackSeriesVideos(seriesItem, config) {\n    const params = {\n        ParentId: seriesItem.Id,\n        IncludeItemTypes: Array.from(SERIES_CHILD_ITEM_TYPES).join(','),\n        Fields: 'Name,IndexNumber,ParentIndexNumber,Id,Overview,PremiereDate,ImageTags,SortName',\n        SortBy: 'ParentIndexNumber,IndexNumber,SortName',\n        SortOrder: 'Ascending',\n        Recursive: true,\n        UserId: config.userId,\n        Limit: 3000,\n        ImageTypeLimit: 1,\n        EnableImageTypes: 'Primary'\n    };\n\n    const data = await makeEmbyApiRequest(${config.serverUrl}/Users//Items, params, config);\n    if (!data?.Items?.length) return [];\n\n    let fallbackCounter = 1;\n    return data.Items\n        .filter(child => child && SERIES_CHILD_ITEM_TYPES.has(child.Type))\n        .map(child => {\n            const fallbackId = buildFallbackMetaId(EMBY_ID_KINDS.EPISODE, child.Id);\n            if (!fallbackId) return null;\n\n            const orderIndex = fallbackCounter++;\n            const seasonNumber = typeof child.ParentIndexNumber === 'number' ? child.ParentIndexNumber : 1;\n            const episodeNumber = typeof child.IndexNumber === 'number' ? child.IndexNumber : orderIndex;\n\n            const video = {\n                id: fallbackId,\n                title: child.Name || Episode ,\n                season: seasonNumber,\n                episode: episodeNumber\n            };\n\n            if (child.Overview) video.overview = child.Overview;\n            if (child.PremiereDate) video.released = child.PremiereDate;\n\n            const thumb = buildPrimaryImageUrl(child, config);\n            if (thumb) video.thumbnail = thumb;\n\n            return video;\n        })\n        .filter(Boolean)\n        .sort((a, b) => {\n            const seasonDiff = (a.season ?? 0) - (b.season ?? 0);\n            if (seasonDiff !== 0) return seasonDiff;\n            return (a.episode ?? 0) - (b.episode ?? 0);\n        });\n}\n\n;

data = replaceFunction(data, 'async function buildFallbackSeriesVideos', newBuildFallback);

const newGetLibraryMetas = sync function getLibraryMetas(libraryId, stremioType, options = {}, config) {\n    const { libraryId: baseLibraryId, mode } = parseLibraryCatalogId(libraryId);\n\n    const params = {\n        ParentId: baseLibraryId,\n        IncludeItemTypes: (stremioType === 'series' ? SERIES_ITEM_TYPES : MOVIE_ITEM_TYPES).join(','),\n        Fields: 'ProviderIds,Name,Overview,ProductionYear,ImageTags,BackdropImageTags,PremiereDate',\n        ImageTypeLimit: 2,\n        EnableImageTypes: 'Primary,Backdrop',\n        Recursive: true,\n        UserId: config.userId,\n        Limit: typeof options.limit === 'number' ? options.limit : DEFAULT_CATALOG_LIMIT\n    };\n\n    if (typeof options.skip === 'number' && options.skip >= 0) {\n        params.StartIndex = options.skip;\n    }\n\n    if (options.search && options.search.trim()) {\n        params.SearchTerm = options.search.trim();\n    }\n\n    let sortStrategy = options.sort;\n    if (!sortStrategy && mode === 'lastAdded') {\n        sortStrategy = 'lastAdded';\n    }\n\n    if (sortStrategy === 'lastAdded') {\n        params.SortBy = 'DateCreated';\n        params.SortOrder = 'Descending';\n    } else if (!params.SearchTerm || sortStrategy === 'name') {\n        params.SortBy = 'SortName';\n        params.SortOrder = 'Ascending';\n    }\n\n    const data = await makeEmbyApiRequest(${config.serverUrl}/Users//Items, params, config);\n    if (!data?.Items?.length) return [];\n\n    const allowedTypes = new Set(stremioType === 'series' ? SERIES_ITEM_TYPES : MOVIE_ITEM_TYPES);\n    const visitedFolders = new Set();\n    const seenItems = new Set();\n    const expandedItems = [];\n    const queue = Array.isArray(data.Items) ? [...data.Items] : [];\n\n    while (queue.length) {\n        const current = queue.shift();\n        if (!current) continue;\n\n        if (stremioType === 'series' && current.Type === 'Folder') {\n            if (visitedFolders.has(current.Id)) continue;\n            visitedFolders.add(current.Id);\n\n            const childParams = {\n                ParentId: current.Id,\n                IncludeItemTypes: SERIES_ITEM_TYPES.join(','),\n                Fields: 'ProviderIds,Name,Overview,ProductionYear,ImageTags,BackdropImageTags,PremiereDate',\n                ImageTypeLimit: 2,\n                EnableImageTypes: 'Primary,Backdrop',\n                Recursive: false,\n                UserId: config.userId,\n                Limit: DEFAULT_CATALOG_LIMIT\n            };\n            const childData = await makeEmbyApiRequest(${config.serverUrl}/Users//Items, childParams, config);\n            const childItems = Array.isArray(childData?.Items) ? childData.Items : [];\n\n            let hasAllowedChild = false;\n            for (const child of childItems) {\n                if (!child) continue;\n                if (child.Type === 'Folder') {\n                    if (!visitedFolders.has(child.Id)) {\n                        queue.push(child);\n                    }\n                    continue;\n                }\n                if (!seenItems.has(child.Id)) {\n                    queue.push(child);\n                }\n                if (allowedTypes.has(child.Type)) {\n                    hasAllowedChild = true;\n                }\n            }\n\n            if (!hasAllowedChild && !seenItems.has(current.Id)) {\n                expandedItems.push(current);\n                seenItems.add(current.Id);\n            }\n            continue;\n        }\n\n        if (allowedTypes.has(current.Type) && !seenItems.has(current.Id)) {\n            expandedItems.push(current);\n            seenItems.add(current.Id);\n        }\n    }\n\n    if (!expandedItems.length) return [];\n\n    const metas = await Promise.all(\n        expandedItems.map(item => mapEmbyItemToMeta(item, stremioType, config))\n    );\n\n    return metas.filter(Boolean);\n}\n\n;

data = replaceFunction(data, 'async function getLibraryMetas', newGetLibraryMetas);

fs.writeFileSync(path, data, 'utf8');
