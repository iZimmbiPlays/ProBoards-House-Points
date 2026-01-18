/* ---------------------------------------------------------
   Points Log Page (?points)
   --------------------------------------------------------- */

/**
 * Render the global Points Log page for all users.
 * Triggered when ?points is present in the URL.
 */
function renderPointsLogPage() {
    if (!isPointsLogPage()) return;

    const me = getCurrentUser();
    if (!me || !me.id) return;

    const $content = $("#content");
    if ($content.length) $content.children().hide();

    const totals = getTotals();
    const log = Array.isArray(totals.log) ? totals.log.slice() : [];

    // Only show point types enabled for the log
    const allowedLogTypes = getLogEnabledTypeIds();

    const filtered = log
        .filter(x => x && typeof x === "object")
        .filter(x => toInt(x.delta, 0) > 0)
        .filter(x => allowedLogTypes.has(String(x.type_id)));

    const rows = filtered.map(n => {
        const pts = `+${toInt(n.delta, 0)}`;
        const userId = toInt(n.user_id, 0);

        const stored = (n.user_name || "").trim();
        let initialName = stored
            .replace(/^view\s+profile\s*-\s*/i, "")
            .replace(/\s*\([^)]*\)\s*$/, "")
            .trim();

        const userCell = (userId && initialName) ?
              `<a class="o-user-link" href="/user/${userId}">${htmlEncode(initialName)}</a>`
            : htmlEncode(initialName || "Unknown");

        const reason = htmlEncode(n.reason || "");
        const staffName = htmlEncode(n.staff_name || "Staff");
        const staffCell = n.staff_id ?
              `<a class="o-user-link" href="/user/${toInt(n.staff_id, 0)}">${staffName}</a>`
            : staffName;

        const date = htmlEncode(formatDateNoTime(toInt(n.ts, 0)));

        return `
<tr>
    <td class="hp-pl-cell hp-pl-points">${pts}</td>
    <td class="hp-pl-cell hp-pl-user" data-hp-user-id="${userId}" data-hp-user-fallback="${htmlEncode(initialName)}">${userCell}</td>
    <td class="hp-pl-cell hp-pl-reason">${reason}</td>
    <td class="hp-pl-cell hp-pl-staff">${staffCell}</td>
    <td class="hp-pl-cell hp-pl-date">${date}</td>
</tr>`;
    }).join("");

    const backUrl = (() => {
        try {
            const url = new URL(window.location.href);
            url.searchParams.delete("points");
            return url.pathname + (url.search || "");
        } catch {
            return window.location.pathname;
        }
    })();

    const title = getPointsLogLinkText();

    let typeNote = "Showing positive awards for enabled point types.";
    try {
        const pts = getPointTypes().filter(t => allowedLogTypes.has(String(t.type_id)));
        if (pts.length) {
            typeNote = "Showing positive awards for: <strong>" +
                pts.map(t => htmlEncode(t.abbr || t.type_id)).join(", ") +
                "</strong>.";
        }
    } catch (e) {}

    const html = `
<div class="container hp-pointslog">
    <div class="title-bar"><h2>${htmlEncode(title)}</h2></div>
    <div class="content pad-all">
        <a class="hp-pl-back" href="${htmlEncode(backUrl)}">&larr; Back</a>
        <div class="hp-pl-note">${typeNote}</div>

        <table class="list hp-pl-table">
            <thead>
                <tr>
                    <th>Points</th>
                    <th>User</th>
                    <th>Reason</th>
                    <th>Staff</th>
                    <th>Date</th>
                </tr>
            </thead>
            <tbody>
                ${rows || `<tr><td colspan="5" class="hp-pl-empty">No point entries yet.</td></tr>`}
            </tbody>
        </table>
    </div>
</div>`;

    $content.append($(html).show());

    // Live-update names to reflect display name changes
    const seen = {};
    document.querySelectorAll(".hp-pl-user[data-hp-user-id]").forEach(td => {
        const uid = toInt(td.getAttribute("data-hp-user-id"), 0);
        if (!uid || seen[uid]) return;
        seen[uid] = true;

        const fallback = (td.getAttribute("data-hp-user-fallback") || "").trim();
        fetchLiveDisplayName(uid, fallback, function (liveName) {
            if (!liveName) return;
            document.querySelectorAll(`.hp-pl-user[data-hp-user-id="${uid}"]`).forEach(cell => {
                cell.innerHTML = `<a class="o-user-link" href="/user/${uid}">${htmlEncode(liveName)}</a>`;
            });
        });
    });
}
