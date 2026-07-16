export const computeFlowLayout = (payload) => {
    const { layout = 'vertical-tree', nodes = [], edges = [] } = payload;
    let positionedNodes = [];
    
    // 1. Build adjacency list & calculate indegrees
    const adj = {};
    const inDegree = {};
    nodes.forEach(n => { adj[n.id] = []; inDegree[n.id] = 0; });
    edges.forEach(e => {
        if (adj[e.from]) adj[e.from].push(e.to);
        if (inDegree[e.to] !== undefined) inDegree[e.to]++;
    });

    // 2. Identify root nodes
    const roots = nodes.filter(n => inDegree[n.id] === 0);
    if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0]); // Cycle fallback

    const Y_GAP = 280;
    const X_GAP = 350;

    const visited = new Set();
    const positions = {};

    // Recursive DFS Subtree Spacing Solver
    const layoutSubtree = (nodeId, px, py) => {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);

        positions[nodeId] = { x: px, y: py };

        const children = adj[nodeId] || [];
        const unvisitedChildren = children.filter(cid => !visited.has(cid));
        const N = unvisitedChildren.length;

        if (N > 0) {
            if (layout === 'vertical-tree') {
                const totalWidth = (N - 1) * X_GAP;
                const startX = px - (totalWidth / 2);
                unvisitedChildren.forEach((childId, idx) => {
                    layoutSubtree(childId, startX + (idx * X_GAP), py + Y_GAP);
                });
            } else if (layout === 'horizontal-process') {
                const totalHeight = (N - 1) * Y_GAP;
                const startY = py - (totalHeight / 2);
                unvisitedChildren.forEach((childId, idx) => {
                    layoutSubtree(childId, px + X_GAP, startY + (idx * Y_GAP));
                });
            }
        }
    };

    // 3. Position root elements
    if (layout === 'vertical-tree') {
        const totalRootsWidth = (roots.length - 1) * X_GAP * 2;
        const startRootsX = -(totalRootsWidth / 2);
        roots.forEach((root, idx) => {
            layoutSubtree(root.id, startRootsX + (idx * X_GAP * 2), 0);
        });
    } else if (layout === 'horizontal-process') {
        const totalRootsHeight = (roots.length - 1) * Y_GAP * 2;
        const startRootsY = -(totalRootsHeight / 2);
        roots.forEach((root, idx) => {
            layoutSubtree(root.id, 0, startRootsY + (idx * Y_GAP * 2));
        });
    } else if (layout === 'circular-cycle') {
        const radius = Math.max(280, nodes.length * 55);
        nodes.forEach((node, idx) => {
            const angle = (idx / nodes.length) * 2 * Math.PI;
            positions[node.id] = {
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius
            };
        });
    } else if (layout === 'comparison-split') {
        let leftY = 0, rightY = 0;
        nodes.forEach(node => {
            if (node.side === 'left') {
                positions[node.id] = { x: -280, y: leftY };
                leftY += Y_GAP;
            } else if (node.side === 'right') {
                positions[node.id] = { x: 280, y: rightY };
                rightY += Y_GAP;
            } else {
                positions[node.id] = { x: 0, y: Math.max(leftY, rightY) };
            }
            visited.add(node.id);
        });
        const maxLeftY = Math.max(0, leftY - Y_GAP);
        const maxRightY = Math.max(0, rightY - Y_GAP);
        nodes.forEach(node => {
            if (node.side === 'left') positions[node.id].y -= maxLeftY / 2;
            if (node.side === 'right') positions[node.id].y -= maxRightY / 2;
        });
    } else if (layout === 'split-list') {
        const leftNodes = nodes.filter(n => n.side === 'left');
        const rightNodes = nodes.filter(n => n.side === 'right');
        const ROW_GAP = 240;

        leftNodes.forEach((lnode, idx) => {
            positions[lnode.id] = { x: -160, y: idx * ROW_GAP };
            const edge = edges.find(e => e.from === lnode.id || e.to === lnode.id);
            if (edge) {
                const targetId = edge.from === lnode.id ? edge.to : edge.from;
                const rnode = rightNodes.find(n => n.id === targetId);
                if (rnode) {
                    positions[rnode.id] = { x: 160, y: idx * ROW_GAP };
                    visited.add(rnode.id);
                }
            }
            visited.add(lnode.id);
        });

        let remainingRightY = 0;
        rightNodes.forEach(rnode => {
            if (!visited.has(rnode.id)) {
                positions[rnode.id] = { x: 220, y: remainingRightY * ROW_GAP };
                remainingRightY++;
                visited.add(rnode.id);
            }
        });

        const totalHeight = (leftNodes.length - 1) * ROW_GAP;
        nodes.forEach(node => {
            if (positions[node.id]) {
                positions[node.id].y -= totalHeight / 2;
            }
        });
    } else {
        const rootId = roots[0]?.id;
        positions[rootId] = { x: 0, y: 0 };
        visited.add(rootId);
        const children = nodes.filter(n => n.id !== rootId);
        const radius = Math.max(250, children.length * 50);
        children.forEach((node, idx) => {
            const angle = (idx / children.length) * 2 * Math.PI;
            positions[node.id] = {
                x: Math.cos(angle) * radius,
                y: Math.sin(angle) * radius
            };
        });
    }

    nodes.forEach(n => {
        if (!positions[n.id]) positions[n.id] = { x: 0, y: 0 };
    });

    positionedNodes = nodes.map(n => ({
        ...n,
        x: positions[n.id].x,
        y: positions[n.id].y,
        type: n.type || 'rectangle',
        animation: n.animation || 'pop-in'
    }));

    const SAFE_GAP = 280;
    for (let pass = 0; pass < 3; pass++) {
        const levelsY = {};
        positionedNodes.forEach(node => {
            const y = node.y;
            if (!levelsY[y]) levelsY[y] = [];
            levelsY[y].push(node);
        });

        Object.keys(levelsY).forEach(yStr => {
            const rowNodes = levelsY[yStr];
            rowNodes.sort((a, b) => a.x - b.x);

            for (let i = 0; i < rowNodes.length - 1; i++) {
                const nodeA = rowNodes[i];
                const nodeB = rowNodes[i + 1];
                const distance = Math.abs(nodeB.x - nodeA.x);
                
                if (distance < SAFE_GAP) {
                    const overlap = SAFE_GAP - distance;
                    nodeA.x = nodeA.x - (overlap / 2);
                    nodeB.x = nodeB.x + (overlap / 2);
                }
            }
        });
    }

    return { elements: positionedNodes, edges };
};