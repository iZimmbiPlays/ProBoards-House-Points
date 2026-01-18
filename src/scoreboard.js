/* ---------------------------------------------------------
   Scoreboard Helpers + Rendering
   --------------------------------------------------------- */

/** Identify the current board id (scoreboard only renders on configured board). */
function getCurrentBoardId() {
    const el = getScoreboardEl();
    const attr = el ? el.getAttribute("data-board-id") : null;
    const fromAttr = toInt(attr, null);
    if (fromAttr) return fromAttr;

    const m = window.location.pathname.match(/\/board\/(\d+)/i);
    if (m) return toInt(m[1], null);

    try {
        const params = pb.form.consolidate_params();
        const candidates = [params.board_id, params.board, params.b, params.id];
        for (let i = 0; i < candidates.length; i++) {
            const n = toInt(candidates[i], null);
            if (n) return n;
        }
    } catch (e) {}

    return null;
}

/** Build link to ghost log page: ?points */
function buildPointsLogUrl() {
    try {
        const url = new URL(window.location.href);
        url.searchParams.set("points", "");
        return url.pathname + url.search;
    } catch (e) {
        const hasQuery = window.location.search && window.location.search.length > 0;
        return window.location.pathname + (hasQuery ? (window.location.search + "&points") : "?points");
    }
}

/** Detect whether we are on ghost log page. */
function isPointsLogPage() {
    try {
        const url = new URL(window.location.href);
        return url.searchParams.has("points");
    } catch (e) {
        return (window.location.search || "").indexOf("points") >= 0;
    }
}

/**
 * Render the scoreboard row + Points Log link.
 * Only renders on the configured board id.
 */
function renderScoreboard() {
    const host = getScoreboardEl();
    if (!host) return;

    const targetBoardId = getScoreboardBoardId();
    const hereBoardId = getCurrentBoardId();

    if (!targetBoardId || !hereBoardId || hereBoardId !== targetBoardId) {
        host.innerHTML = "";
        return;
    }

    const teams = getHouseTeamList();
    const totals = getTotals();
    const types = getPointTypes().filter(t => t.enabled);
    const showName = getShowTeamName();

    const rowHtml = teams.map(t => {
        const gid = t.group_id;
        const label = t.label || ("Group " + gid);
        const img = t.image;

        const groupTotals = safeObj(totals.by_group[String(gid)]) || {};

        let sum = 0;
        for (const x of types) {
            if (!x.include_in_total) continue;
            sum += toInt(groupTotals[x.type_id], 0);
        }

        const imgHtml = img ?
              `<img class="hp-scoreboard-img" src="${htmlEncode(img)}" alt="${htmlEncode(label)}">`
            : "";

        const labelHtml = showName ? `<div class="hp-scoreboard-label">${htmlEncode(label)}</div>` : "";

        return `<div class="hp-scoreboard-item">${imgHtml}${labelHtml}<div class="hp-scoreboard-total">${sum}</div></div>`;
    }).join("");

    const pointsUrl = buildPointsLogUrl();
    const linkText = getPointsLogLinkText();

    host.innerHTML = `
<div class="hp-scoreboard">
    <div class="hp-scoreboard-row">${rowHtml}</div>
    <div class="hp-scoreboard-links">
        <a class="hp-pointslog-link" href="${htmlEncode(pointsUrl)}">${htmlEncode(linkText)}</a>
    </div>
</div>
`;
}
