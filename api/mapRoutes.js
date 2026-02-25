const express = require('express');
const admin = require('firebase-admin');

const router = express.Router();
const db = admin.firestore();

const IN_QUERY_CHUNK_SIZE = 30;
const MAP_VERSION = 2;

const DISCOVERED_NODE_STYLE = 'fill:#f5f1ea,stroke:#8c6f54,stroke-width:2px,color:#3a2d21';
const UNDISCOVERED_NODE_STYLE = 'fill:#eef2f6,stroke:#8a97a6,stroke-width:1px,color:#4c5560,stroke-dasharray: 4 2';

function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

function uniqueStrings(values) {
    const seen = new Set();
    const result = [];
    for (const value of values || []) {
        const normalized = String(value || '').trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

async function fetchLocationDocsByIds(locationNames) {
    const names = uniqueStrings(locationNames);
    if (names.length === 0) return [];

    const locationsRef = db.collection('locations');
    const docs = [];

    for (const chunk of chunkArray(names, IN_QUERY_CHUNK_SIZE)) {
        const snapshot = await locationsRef
            .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
            .get();
        snapshot.forEach(doc => docs.push(doc));
    }

    return docs;
}

function sanitizeText(value, fallback = 'Unknown') {
    const text = String(value ?? '').trim();
    return text || fallback;
}

function escapeMermaidNodeLabel(value) {
    return sanitizeText(value, 'Unknown')
        .replace(/\r?\n/g, ' ')
        .replace(/"/g, "'")
        .replace(/\[/g, '（')
        .replace(/\]/g, '）')
        .replace(/\|/g, '｜')
        .replace(/`/g, '')
        .trim();
}

function escapeMermaidEdgeLabel(value) {
    return sanitizeText(value, '...')
        .replace(/\r?\n/g, ' ')
        .replace(/\|/g, '/')
        .replace(/"/g, "'")
        .replace(/`/g, '')
        .trim()
        .slice(0, 30) || '...';
}

function normalizeNearbyLocations(geography) {
    const raw = geography && Array.isArray(geography.nearbyLocations)
        ? geography.nearbyLocations
        : [];

    const byName = new Map();
    for (const entry of raw) {
        if (typeof entry === 'string') {
            const name = sanitizeText(entry, '');
            if (!name) continue;
            if (!byName.has(name)) byName.set(name, { name, travelTime: '' });
            continue;
        }

        if (!entry || typeof entry !== 'object') continue;
        const name = sanitizeText(
            entry.name || entry.locationName || entry.target || entry.id,
            ''
        );
        if (!name) continue;
        const travelTime = sanitizeText(
            entry.travelTime || entry.time || entry.duration || '',
            ''
        );
        const existing = byName.get(name);
        if (!existing) {
            byName.set(name, { name, travelTime });
        } else if (!existing.travelTime && travelTime) {
            existing.travelTime = travelTime;
        }
    }

    return Array.from(byName.values());
}

function inferParentLocationName(staticData, fallbackLocationName) {
    if (staticData && typeof staticData.parentLocation === 'string' && staticData.parentLocation.trim()) {
        return staticData.parentLocation.trim();
    }

    const address = (staticData && typeof staticData.address === 'object' && staticData.address) || {};
    const locationName = sanitizeText(
        (staticData && staticData.locationName) || fallbackLocationName,
        ''
    );

    const chain = uniqueStrings([
        address.country,
        address.region,
        address.city,
        address.district,
        address.town,
        address.village,
    ]);

    if (chain.length >= 2) {
        const idx = chain.lastIndexOf(locationName);
        if (idx > 0) return chain[idx - 1];
    }

    // Fallback heuristics if the location name does not match address fields.
    if (address.town && address.district) return sanitizeText(address.district, '');
    if (address.district && address.city) return sanitizeText(address.city, '');
    if (address.city && address.region) return sanitizeText(address.region, '');
    if (address.region && address.country) return sanitizeText(address.country, '');

    return '';
}

function normalizeLocationNode(docId, data, discovered) {
    const staticData = (data && typeof data === 'object') ? data : {};
    const name = sanitizeText(staticData.locationName || docId, docId);
    return {
        name,
        label: name,
        locationType: sanitizeText(staticData.locationType || '未知', '未知'),
        discovered: Boolean(discovered),
        parentName: inferParentLocationName(staticData, name),
        nearbyLocations: normalizeNearbyLocations(staticData.geography),
    };
}

function collectReferencedLocationNames(nodes) {
    const names = new Set();
    for (const node of nodes.values()) {
        if (node.parentName) names.add(node.parentName);
        for (const neighbor of node.nearbyLocations) {
            if (neighbor && neighbor.name) names.add(neighbor.name);
        }
    }
    return names;
}

function createNodeIdMap(nodes) {
    const idMap = new Map();
    const sortedNames = Array.from(nodes.keys()).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    sortedNames.forEach((name, index) => {
        idMap.set(name, `loc${index}`);
    });
    return idMap;
}

function addUniqueEdge(edges, dedupeSet, edge, dedupeKey) {
    if (dedupeSet.has(dedupeKey)) return;
    dedupeSet.add(dedupeKey);
    edges.push(edge);
}

function buildHierarchyEdges(nodes) {
    const edges = [];
    const dedupe = new Set();

    for (const node of nodes.values()) {
        if (!node.parentName || node.parentName === node.name) continue;
        if (!nodes.has(node.parentName)) continue;

        const key = `${node.parentName}-->${node.name}`;
        addUniqueEdge(edges, dedupe, {
            source: node.parentName,
            target: node.name,
            relation: 'hierarchy',
            label: '所屬',
        }, key);
    }

    return edges;
}

function buildAdjacencyEdges(nodes) {
    const edges = [];
    const dedupe = new Set();

    for (const node of nodes.values()) {
        for (const neighbor of node.nearbyLocations) {
            const neighborName = sanitizeText(neighbor && neighbor.name, '');
            if (!neighborName || neighborName === node.name) continue;
            if (!nodes.has(neighborName)) continue;

            const ordered = [node.name, neighborName].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
            const key = `${ordered[0]}---${ordered[1]}`;
            addUniqueEdge(edges, dedupe, {
                source: ordered[0],
                target: ordered[1],
                relation: 'adjacent',
                label: sanitizeText(neighbor.travelTime, ''),
            }, key);
        }
    }

    return edges;
}

function buildMermaidSyntax({ direction, nodes, idMap, edges, title }) {
    if (nodes.size === 0) {
        return 'graph TD;\n    A["你的足跡尚未踏出第一步"];';
    }

    let syntax = `graph ${direction};\n`;
    syntax += `    %% ${title}\n`;
    syntax += '    %% Node definitions\n';

    for (const node of nodes.values()) {
        const nodeId = idMap.get(node.name);
        const label = escapeMermaidNodeLabel(node.label || node.name);
        syntax += `    ${nodeId}["${label}"];\n`;
    }

    syntax += '\n    %% Node styles\n';
    for (const node of nodes.values()) {
        const nodeId = idMap.get(node.name);
        const style = node.discovered ? DISCOVERED_NODE_STYLE : UNDISCOVERED_NODE_STYLE;
        syntax += `    style ${nodeId} ${style};\n`;
    }

    syntax += '\n    %% Link definitions\n';
    for (const edge of edges) {
        const sourceId = idMap.get(edge.source);
        const targetId = idMap.get(edge.target);
        if (!sourceId || !targetId) continue;

        if (edge.relation === 'hierarchy') {
            const label = escapeMermaidEdgeLabel(edge.label || '所屬');
            syntax += `    ${sourceId} -->|"${label}"| ${targetId};\n`;
        } else if (edge.relation === 'adjacent') {
            const label = edge.label ? escapeMermaidEdgeLabel(edge.label) : '';
            if (label) {
                syntax += `    ${sourceId} -.-|"${label}"| ${targetId};\n`;
            } else {
                syntax += `    ${sourceId} -.- ${targetId};\n`;
            }
        }
    }

    return syntax;
}

function buildEmptyResponse(message) {
    const syntax = `graph TD;\n    A["${escapeMermaidNodeLabel(message)}"];`;
    return {
        mapVersion: MAP_VERSION,
        defaultView: 'hierarchy',
        mermaidSyntax: syntax,
        views: {
            hierarchy: {
                title: '階層圖',
                mermaidSyntax: syntax,
                nodes: [],
                edges: [],
            },
            adjacency: {
                title: '鄰接圖',
                mermaidSyntax: syntax,
                nodes: [],
                edges: [],
            },
        },
        meta: {
            discoveredCount: 0,
            renderedNodeCount: 0,
            contextNodeCount: 0,
            hierarchyEdgeCount: 0,
            adjacencyEdgeCount: 0,
        },
    };
}

router.get('/world-map', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const playerLocationsSnapshot = await db
            .collection('users')
            .doc(userId)
            .collection('location_states')
            .get();

        if (playerLocationsSnapshot.empty) {
            return res.json(buildEmptyResponse('你的足跡尚未踏出第一步'));
        }

        const discoveredNames = uniqueStrings(playerLocationsSnapshot.docs.map(doc => doc.id));
        const discoveredSet = new Set(discoveredNames);

        const discoveredDocs = await fetchLocationDocsByIds(discoveredNames);
        if (discoveredDocs.length === 0) {
            return res.json(buildEmptyResponse('輿圖遺失，無法繪製'));
        }

        const nodes = new Map();
        for (const doc of discoveredDocs) {
            const node = normalizeLocationNode(doc.id, doc.data(), true);
            nodes.set(node.name, node);
        }

        // Pull a thin context ring (parents / nearby places) to reduce disconnected graphs.
        const referencedNames = collectReferencedLocationNames(nodes);
        const contextCandidates = Array.from(referencedNames).filter(name => !nodes.has(name));
        const contextDocs = await fetchLocationDocsByIds(contextCandidates);
        for (const doc of contextDocs) {
            const node = normalizeLocationNode(doc.id, doc.data(), discoveredSet.has(doc.id));
            // Keep discovered node if it already exists.
            if (!nodes.has(node.name)) nodes.set(node.name, node);
        }

        const idMap = createNodeIdMap(nodes);
        const hierarchyEdges = buildHierarchyEdges(nodes);
        const adjacencyEdges = buildAdjacencyEdges(nodes);

        const hierarchySyntax = buildMermaidSyntax({
            direction: 'TD',
            nodes,
            idMap,
            edges: hierarchyEdges,
            title: 'Hierarchy View',
        });

        const adjacencySyntax = buildMermaidSyntax({
            direction: 'LR',
            nodes,
            idMap,
            edges: adjacencyEdges,
            title: 'Adjacency View',
        });

        const serializedNodes = Array.from(nodes.values()).map(node => ({
            name: node.name,
            label: node.label,
            locationType: node.locationType,
            discovered: node.discovered,
        }));

        const responsePayload = {
            mapVersion: MAP_VERSION,
            defaultView: 'hierarchy',
            // Backward-compatible field for older clients.
            mermaidSyntax: hierarchySyntax,
            views: {
                hierarchy: {
                    title: '階層圖',
                    mermaidSyntax: hierarchySyntax,
                    nodes: serializedNodes,
                    edges: hierarchyEdges,
                },
                adjacency: {
                    title: '鄰接圖',
                    mermaidSyntax: adjacencySyntax,
                    nodes: serializedNodes,
                    edges: adjacencyEdges,
                },
            },
            meta: {
                discoveredCount: discoveredNames.length,
                renderedNodeCount: nodes.size,
                contextNodeCount: Math.max(0, nodes.size - discoveredNames.length),
                hierarchyEdgeCount: hierarchyEdges.length,
                adjacencyEdgeCount: adjacencyEdges.length,
            },
        };

        res.json(responsePayload);
    } catch (error) {
        console.error('[Map Route] Failed to build world map:', error);
        res.status(500).json({ message: '無法生成地圖資料，請稍後再試。' });
    }
});

module.exports = router;
