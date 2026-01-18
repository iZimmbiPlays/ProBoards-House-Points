/* ---------------------------------------------------------
   Notifications System (Bubble + Profile Tab + Feed)
   --------------------------------------------------------- */

function resolveNotifsKey() {
    try { if (pb.plugin.key(KEY_NOTIFS_PRIMARY)) return KEY_NOTIFS_PRIMARY; } catch (e) {}
    try { if (pb.plugin.key(KEY_NOTIFS_FALLBACK)) return KEY_NOTIFS_FALLBACK; } catch (e) {}
    return null;
}

/* ---------------- Seen Timestamp Logic ---------------- */

function getSeenState(userId) {
    const keyName = resolveNotifsKey();
    if (!keyName) return { reset_version: 0, seen_ts: 0 };

    const obj = safeObj(pb.plugin.key(keyName).get(userId)) || {};
    return {
        reset_version: toInt(obj.reset_version, 0),
        seen_ts: toInt(obj.seen_ts, 0)
    };
}

function setSeenState(userId, seenTs, cb) {
    const keyName = resolveNotifsKey();
    if (!keyName) { if (cb) cb(false); return; }

    pb.plugin.key(keyName).set({
        object_id: userId,
        value: {
            reset_version: getTotals().reset_version,
            seen_ts: toInt(seenTs, 0)
        },
        success: () => cb && cb(true),
        error: () => cb && cb(false)
    });
}

function ensureSeenCurrent(userId, cb) {
const totals = getTotals();
const st = getSeenState(userId);

if (toInt(st.reset_version, 0) !== toInt(totals.reset_version, 0)) {
    setSeenState(userId, 0, function () {
        if (cb) cb({ reset_version: totals.reset_version, seen_ts: 0 });
    });
    return;
}

if (cb) cb(st);
}


/* ---------------- Feed Readers ---------------- */

function getUserNotifsFromTotals(userId, limit) {
    const list = Array.isArray(getTotals().notifs) ? getTotals().notifs : [];
    return list.filter(n => toInt(n.user_id, 0) === toInt(userId, 0)).slice(0, limit);
}

/* ---------------- Notifications Tab Injection ---------------- */

function isOnProfileNotificationsTab() {
    return /\/user\/\d+\/notifications/i.test(window.location.pathname);
}

function findNotificationsTableBody() {
    const table =
        document.querySelector(".show-user table.list") ||
        document.querySelector("#content .show-user table.list") ||
        document.querySelector("#content table.list");

    return table ? table.querySelector("tbody") : null;
}

function injectNotifsIntoNotificationsTab() {
    if (!isOnProfileNotificationsTab()) return;

    const me = getCurrentUser();
    if (!me || !me.id) return;

    const tbody = findNotificationsTableBody();
    if (!tbody) return;

    tbody.querySelectorAll("tr.hp-notif-injected-row").forEach(r => r.remove());

    ensureSeenCurrent(me.id, function (st) {
        const seenTs = st.seen_ts;
        const items = getUserNotifsFromTotals(me.id, 10);

        const templateRow = tbody.querySelector("tr") ? tbody.querySelector("tr").cloneNode(true) : null;
        let newestTs = seenTs;

        const rows = items.map(n => {
            const isNew = toInt(n.ts, 0) > seenTs;
            newestTs = Math.max(newestTs, toInt(n.ts, 0));

            const msg = `${isNew ? `<span class="new-icon">NEW</span> ` : ""}<strong>${htmlEncode(n.abbr)}:</strong> ${n.delta >= 0 ? "+" : ""}${n.delta} for ${htmlEncode(n.reason)} by ${htmlEncode(n.staff_name)}`;
            const date = htmlEncode(formatDateNoTime(n.ts));

            const tr = templateRow ? templateRow.cloneNode(true) : document.createElement("tr");
            tr.classList.add("hp-notif-injected-row");

            const tds = tr.querySelectorAll("td");
            if (tds.length >= 2) {
                tds[0].innerHTML = msg;
                tds[1].innerHTML = date;
            } else {
                tr.innerHTML = `<td>${msg}</td><td>${date}</td>`;
            }
            return tr;
        });

        rows.reverse().forEach(r => tbody.insertBefore(r, tbody.firstChild));

        setTimeout(() => {
            setSeenState(me.id, newestTs || nowTs(), updateNotificationsIndicators);
        }, 200);
    });
}

/* ---------------- Nav Bubble + Profile Tab Count ---------------- */

function updateNotificationsIndicators() {
    const me = getCurrentUser();
    if (!me || !me.id) return;

    ensureSeenCurrent(me.id, function (st) {
        const seenTs = st.seen_ts;
        const unread = getUserNotifsFromTotals(me.id, 200)
            .filter(n => toInt(n.ts, 0) > seenTs).length;

        updateProfileNavBubbleOnly(unread);

        const tabLink = findProfileNotificationsTabLink();
        setParenCountOnNotificationsTabLink(tabLink, isOnProfileNotificationsTab() ? 0 : unread);
    });
}
