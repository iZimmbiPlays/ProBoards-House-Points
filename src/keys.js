/* ---------------------------------------------------------
   DOM Element Getters
   --------------------------------------------------------- */

function getScoreboardEl() {
    return document.getElementById("hp-scoreboard") || document.getElementById("hixhp-scoreboard");
}

function getProfileMetaEl() {
    return document.getElementById("hp-profile-meta") || document.getElementById("hixhp-profile-meta");
}

function getProfileSlotEl() {
    return document.getElementById("hp-profile-slot") || document.getElementById("hixhp-profile-slot");
}

function getResetHostEl() {
    return document.getElementById("hp-reset-ui");
}

/* ---------------------------------------------------------
   UI Readers (Teams + Point Types)
   --------------------------------------------------------- */

function getHouseTeamList() {
    const list = Array.isArray(settings.houseteam_list) ? settings.houseteam_list : [];
    const out = [];

    for (const row of list) {
        if (!row) continue;

        const gid = normalizeId(row.group ?? row.group_id ?? row.groupId);
        if (!gid) continue;

        const label = String(row.display_name ?? row.label ?? "").trim();

        const imgVal =
            row.scoreboard_image ??
            row.scoreboard_images ??
            row.team_image ??
            row.image ??
            row.images;

        const urlFallbackRaw = row.url_image ?? row.urlImage ?? row.url ?? "";
        const urlFallback = (typeof urlFallbackRaw === "string") ? urlFallbackRaw.trim() : "";

        let image = normalizeImageUrl(imgVal);
        if (!image && looksLikeUrl(urlFallback)) image = urlFallback;

        if (!image && label) {
            const key = label.toLowerCase().replace(/\s+/g, "");
            if (pluginImages[key]) image = pluginImages[key];
        }

        out.push({ group_id: gid, label, image });
    }

    return out;
}

function getPointTypes() {
    const list = Array.isArray(settings.point_types) ? settings.point_types : [];

    if (!list.length) {
        return [
            { type_id: "hp",  name: "House Points",    abbr: "HP",  allow_negative: true,  include_in_total: true, enabled: true },
            { type_id: "hwp", name: "Homework Points", abbr: "HWP", allow_negative: false, include_in_total: true, enabled: true }
        ];
    }

    const out = [];
    for (const row of list) {
        const typeId = row && row.type_id ? String(row.type_id).trim() : "";
        if (!typeId) continue;

        const name = row.name ? String(row.name) : typeId;
        const abbr = row.abbr ? String(row.abbr) : typeId.toUpperCase();

        const allowNeg = isTruthy(row.allow_negative, false);
        const includeTotal = isTruthy(row.include_in_scoreboard_total ?? row.include_in_total, true);

        out.push({
            type_id: typeId,
            name,
            abbr,
            allow_negative: allowNeg,
            include_in_total: includeTotal,
            enabled: true
        });
    }

    return out;
}

/* ---------------------------------------------------------
   Keys: Totals + User Points + Global Notifs Feed
   --------------------------------------------------------- */

function getTotalsRaw() {
    return safeObj(pb.plugin.key(KEY_TOTALS).get()) || {};
}

/**
 * Totals key structure:
 * { reset_version, reset_ts, by_group: {...}, log: [...], notifs: [...] }
 */
function getTotals() {
    const obj = getTotalsRaw();

    if (obj.by_group && typeof obj.by_group === "object") {
        return {
            reset_version: toInt(obj.reset_version, 0),
            reset_ts: toInt(obj.reset_ts, 0),
            by_group: safeObj(obj.by_group) || {},
            log: Array.isArray(obj.log) ? obj.log : [],
            notifs: Array.isArray(obj.notifs) ? obj.notifs : []
        };
    }

    // Legacy fallback initialization
    const teams = getHouseTeamList();
    const types = getPointTypes().filter(t => t.enabled);
    const by_group = {};
    for (const ht of teams) {
        const gid = String(ht.group_id);
        by_group[gid] = {};
        for (const t of types) by_group[gid][t.type_id] = 0;
    }

    return { reset_version: 0, reset_ts: 0, by_group, log: [], notifs: [] };
}

function setTotals(data, cb) {
    data.reset_ts = nowTs();
    if (!Array.isArray(data.log)) data.log = [];
    if (!Array.isArray(data.notifs)) data.notifs = [];

    pb.plugin.key(KEY_TOTALS).set({
        value: data,
        success: function () { if (cb) cb(true); },
        error: function () { if (cb) cb(false); }
    });
}

function getUser(userId) {
    const obj = safeObj(pb.plugin.key(KEY_USER).get(userId)) || {};
    return {
        reset_version: toInt(obj.reset_version, 0),
        group_id: toInt(obj.group_id, 0) || null,
        points: safeObj(obj.points) || {},
        updated: toInt(obj.updated, 0)
    };
}

/* ---------------------------------------------------------
   Permissions + Profile Meta
   --------------------------------------------------------- */

function getCurrentUser() {
    if (hasYootil && yootil.user && typeof yootil.user.id === "function") {
        return { id: yootil.user.id(), name: yootil.user.name() };
    }
    const me = pb.data("user") || pb.data("current_user") || {};
    return {
        id: toInt(me.id || me.user_id, null),
        name: String(me.name || me.username || "").trim()
    };
}

function getCurrentUserId() {
    const me = getCurrentUser();
    return me && me.id ? me.id : null;
}

function canEditUser(userId) {
    try { if (userId && pb.plugin.key(KEY_USER).can_write(userId)) return true; } catch (e) {}

    const allowed = normalizeGroupIds(settings.editor_group_ids);
    if (!allowed.length) return false;

    const meRaw = pb.data("user") || pb.data("current_user") || {};
    const myGroup = toInt(meRaw.group_id || meRaw.groupId || (meRaw.group && meRaw.group.id), -1);

    if (meRaw && (meRaw.is_admin === true || meRaw.isAdmin === true)) return true;
    return allowed.includes(myGroup);
}

function canEditTotals() {
    try { return !!pb.plugin.key(KEY_TOTALS).can_write(); }
    catch (e) { return false; }
}

function getProfileMeta() {
    const el = getProfileMetaEl();
    if (!el) return { userId: null, groupId: null };
    return {
        userId: toInt(el.getAttribute("data-user-id"), null),
        groupId: toInt(el.getAttribute("data-group-id"), null)
    };
}

function getProfileUserId() {
    const meta = getProfileMeta();
    if (meta.userId) return meta.userId;

    const m = window.location.pathname.match(/\/user\/(\d+)/i);
    return m ? toInt(m[1], null) : null;
}

function buildDisplayPoints(userId) {
    const totals = getTotals();
    const user = getUser(userId);

    const types = getPointTypes().filter(t => t.enabled);
    const def = getDefaultPoints();
    const resetMismatch = (user.reset_version !== totals.reset_version);

    const points = {};
    for (const t of types) {
        if (resetMismatch) {
            points[t.type_id] = 0;
        } else {
            points[t.type_id] = (Object.prototype.hasOwnProperty.call(user.points, t.type_id)) ?
                toInt(user.points[t.type_id], 0)
                : def;
        }
    }

    let total = 0;
    for (const t of types) total += toInt(points[t.type_id], 0);

    return { points, total, types };
}

/* ---------------------------------------------------------
   Misc Helpers for Notifications Feed + Log Naming
   --------------------------------------------------------- */

function pushGlobalLogEntry(entry) {
    const totals = getTotals();
    const log = Array.isArray(totals.log) ? totals.log.slice() : [];
    log.unshift(entry);

    const CAP = 250;
    while (log.length > CAP) log.pop();

    totals.log = log;
    return totals;
}

function pushGlobalNotifEntry(entry) {
    const totals = getTotals();
    const list = Array.isArray(totals.notifs) ? totals.notifs.slice() : [];
    list.unshift(entry);

    const CAP = 500;
    while (list.length > CAP) list.pop();

    totals.notifs = list;
    return totals;
}

function getDisplayedProfileNameFor(userId) {
    userId = toInt(userId, 0);
    if (!userId) return "";

    try {
        const u = pb.data("user") || {};
        if (toInt(u.id, 0) === userId) {
            const nm = String(u.name || u.username || "").trim();
            if (nm) return nm;
        }
    } catch (e) {}

    const root = document.querySelector(".show-user") || document.getElementById("content") || document.body;
    const sels = [
        ".show-user .user-name",
        ".show-user .display-name",
        ".show-user .username",
        ".show-user h1",
        ".show-user .title-bar h1",
        ".show-user .title-bar h2"
    ];
    for (const sel of sels) {
        const el = root.querySelector(sel);
        if (!el) continue;
        const t = (el.textContent || "").trim();
        if (t && t.length <= 90) return t;
    }

    return "";
}
