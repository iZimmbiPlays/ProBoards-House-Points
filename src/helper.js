(function () {
    "use strict";
    // =========================
    // House Points Plugin
    // Plugin ID: house_points
    // Plugin Creator: Amanda Zimmer / Teg https://support.proboards.com/user/114253
    // License: MIT License
    // Keys:
    //  - hp_user   (User super)
    //  - hp_totals (Forum super)
    //
    // REQUIRED TEMPLATE PLACEHOLDERS
    // 1) Board Header/Footer component:
    //    <div id="hp-scoreboard" data-board-id="$[board.id]"></div>
    //
    // 2) Profile (Summary) template:
    //    <div id="hp-profile-meta"
    //         data-user-id="$[user.id]"
    //         data-group-id="{if $[user.group]}$[user.group.id]{else}0{/if}">
    //    </div>
    //    <tbody id="hp-profile-slot"></tbody>
    //
    // 3) Mini-profile template (optional):
    //    <div class="hp-mini-slot"></div>
    //
    // 4) Admin Tools code box (optional, only renders where this exists):
    //    <div id="hp-reset-ui"></div>
    // =========================

    const PLUGIN_ID = "house_points";

    const KEY_TOTALS = "hp_totals";
    const KEY_USER = "hp_user";
    const KEY_NOTIFS_PRIMARY = "hp_notifications";
    const KEY_NOTIFS_FALLBACK = "hp_notificationss";

    const plugin = pb.plugin.get(PLUGIN_ID) || {};
    const settings = plugin.settings || {};
    const pluginImages = plugin.images || {};

    const hasYootil = typeof yootil !== "undefined";

    /* ---------------------------------------------------------
       Utility Helpers
       --------------------------------------------------------- */

    /** HTML-encode for safe output into templates. */
    function htmlEncode(s) {
        s = (s == null) ? "" : String(s);
        if (hasYootil && typeof yootil.html_encode === "function") return yootil.html_encode(s);
        if (pb.text && typeof pb.text.escape_html === "function") return pb.text.escape_html(s);
        return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    /** Unix timestamp (seconds). */
    function nowTs() {
        return Math.floor(Date.now() / 1000);
    }

    /** Parse int safely. */
    function toInt(v, fallback = 0) {
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : fallback;
    }

    /** Ensure a value is an object (not null/array). */
    function safeObj(v) {
        return (v && typeof v === "object") ? v : null;
    }

    /** Convert truthy-ish UI values to boolean. */
    function isTruthy(v, defaultValue = true) {
        if (v === undefined || v === null || v === "") return defaultValue;
        const s = String(v).toLowerCase();
        if (s === "false" || s === "0" || s === "no") return false;
        if (s === "true" || s === "1" || s === "yes") return true;
        return defaultValue;
    }

    /** Detect a URL-ish string. */
    function looksLikeUrl(s) {
        return typeof s === "string" && (s.startsWith("http://") || s.startsWith("https://") || s.startsWith("//"));
    }

    /** Normalize various UI field shapes into an integer id. */
    function normalizeId(val) {
        if (val == null) return null;
        if (Array.isArray(val)) return val.length ? normalizeId(val[0]) : null;
        if (typeof val === "object") {
            const cand = val.id ?? val.value ?? val.group_id ?? val.groupId ?? val.board_id ?? val.boardId;
            return toInt(cand, null);
        }
        return toInt(val, null);
    }

    /** Normalize group id list inputs from UI. */
    function normalizeGroupIds(val) {
        if (val == null) return [];
        if (Array.isArray(val)) return val.map(normalizeId).filter(x => x && x > 0);
        const one = normalizeId(val);
        return one ? [one] : [];
    }

    /** Normalize a plugin image field (url, plugin image key, object, etc.) to a usable URL string. */
    function normalizeImageUrl(val) {
        if (!val) return "";
        if (Array.isArray(val)) return normalizeImageUrl(val[0]);

        if (typeof val === "string") {
            const t = val.trim();
            if (!t) return "";
            if (looksLikeUrl(t)) return t;
            if (pluginImages[t]) return pluginImages[t];
            const key = t.toLowerCase();
            if (pluginImages[key]) return pluginImages[key];
            return "";
        }

        if (typeof val === "object") {
            const url = (val.url || val.src || val.image_url || val.image || "").toString().trim();
            if (looksLikeUrl(url)) return url;

            const name = (val.name || val.id || val.value || "").toString().trim();
            if (name) {
                if (pluginImages[name]) return pluginImages[name];
                const key = name.toLowerCase();
                if (pluginImages[key]) return pluginImages[key];
            }
        }
        return "";
    }

    /** Format dates like "January 18, 2026". */
    function formatDateNoTime(tsSec) {
        if (!tsSec) return "";
        const d = new Date(tsSec * 1000);
        const months = hasYootil && yootil.months ? yootil.months : [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];
        const mm = months[d.getMonth()];
        const dd = String(d.getDate()).padStart(2, "0");
        const yyyy = d.getFullYear();
        return `${mm} ${dd}, ${yyyy}`;
    }
	// Counts unread point notifications by checking item.read === false
	function countUnread(items) {
		if (!Array.isArray(items)) return 0;
		return items.reduce((acc, n) => acc + ((n && n.read === false) ? 1 : 0), 0);
	}
    /* ---------------------------------------------------------
       Live Display Name Fetching (for Points Log)
       --------------------------------------------------------- */

    /** Cache of live names fetched from /user/{id} pages. */
    const __hpNameCache = {};

    /**
     * Fetch a user's current display name from their profile page.
     * This allows Points Log to update past entries if a user changes display name.
     */
    function fetchLiveDisplayName(userId, fallback, done) {
        userId = toInt(userId, 0);
        if (!userId) return done((fallback || "").trim());

        if (__hpNameCache[userId]) return done(__hpNameCache[userId]);

        $.get(`/user/${userId}`, function (html) {
            let name = "";

            try {
                const doc = new DOMParser().parseFromString(html, "text/html");

                // Common ProBoards selectors
                const candidates = [
                    ".show-user .user-name",
                    ".show-user .username",
                    ".show-user .display-name",
                    ".show-user h1",
                    ".show-user .title-bar h1",
                    ".show-user .title-bar h2",
                    "h1"
                ];

                for (const sel of candidates) {
                    const el = doc.querySelector(sel);
                    if (!el) continue;
                    const t = (el.textContent || "").trim();
                    if (t && t.length <= 90) { name = t; break; }
                }

                // Fallback: parse <title> e.g. "View Profile - Severus Snape (severus)"
                if (!name) {
                    const t = (doc.title || "").trim();
                    const m = t.match(/view\s+profile\s*-\s*(.+?)\s*(\(|$)/i);
                    if (m && m[1]) name = m[1].trim();
                }
            } catch (e) {}

            name = (name || fallback || "").trim();
            name = name
                .replace(/^view\s+profile\s*-\s*/i, "")
                .replace(/\s*\([^)]*\)\s*$/, "")
                .trim();

            __hpNameCache[userId] = name || (fallback || "").trim();
            done(__hpNameCache[userId]);
        }).fail(function () {
            done((fallback || "").trim());
        });
    }
    // Ensure each notification has a stable id so we can merge safely.
	function ensureNotifIds(items) {
	if (!Array.isArray(items)) return [];

	return items.map((n, idx) => {
		if (!n || typeof n !== "object") return null;
		if (n.id) return n;

		// Use idx to prevent collisions for entries created in same second with same fields
		const base = [
			toInt(n.ts, 0),
			toInt(n.user_id, 0),
			toInt(n.staff_id, 0),
			String(n.type_id || ""),
			toInt(n.delta, 0),
			String(n.reason || ""),
			idx
		].join("|");

		return Object.assign({}, n, { id: "hp_" + base });
	}).filter(Boolean);
}


	// Merge a new notification into an existing list by id (no duplicates), newest first.
	function mergeNotifs(newNotif, existingItems, cap) {
	const existing = ensureNotifIds(existingItems);
	const incoming = ensureNotifIds([newNotif])[0];
	if (!incoming) return existing.slice(0, cap);

	const map = new Map();

	// Put incoming first so it stays near the top, but merge read state safely
	[incoming].concat(existing).forEach(n => {
		if (!n || !n.id) return;

		if (!map.has(n.id)) {
			map.set(n.id, n);
			return;
		}

		// If duplicate id exists, prefer read:true (never regress to unread)
		const prev = map.get(n.id);
		const merged = Object.assign({}, prev);

		merged.read = (prev.read === true || n.read === true) ? true : false;

		// Keep the latest timestamp just in case
		merged.ts = Math.max(toInt(prev.ts, 0), toInt(n.ts, 0));

		map.set(n.id, merged);
	});

	// Sort newest first
	const mergedArr = Array.from(map.values()).sort((a, b) => toInt(b.ts, 0) - toInt(a.ts, 0));
	return mergedArr.slice(0, cap);
}

    /* ---------------------------------------------------------
       DOM Element Getters
       --------------------------------------------------------- */

    /** Scoreboard placeholder host. */
    function getScoreboardEl() {
        return document.getElementById("hp-scoreboard") || document.getElementById("hixhp-scoreboard");
    }

    /** Profile meta holder (contains user id and group id). */
    function getProfileMetaEl() {
        return document.getElementById("hp-profile-meta") || document.getElementById("hixhp-profile-meta");
    }

    /** Profile points table body slot. */
    function getProfileSlotEl() {
        return document.getElementById("hp-profile-slot") || document.getElementById("hixhp-profile-slot");
    }

    /** Optional reset/admin tools host. */
    function getResetHostEl() {
        return document.getElementById("hp-reset-ui");
    }

    /* ---------------------------------------------------------
       Settings Getters
       --------------------------------------------------------- */

    /** Board id where scoreboard should render. */
    function getScoreboardBoardId() {
        return normalizeId(settings.scoreboard_board_id ?? settings.scoreboard_board);
    }

    /** Whether to show team name under images on the scoreboard. */
    function getShowTeamName() {
        const v =
            settings.show_team_name_under_image ??
            settings.show_team_name ??
            settings.show_house_label ??
            settings.show_house_team_name ??
            settings.scoreboard_show_team_name;
        return isTruthy(v, false);
    }
    
    function getLogEnabledTypeIds() {
	const list = Array.isArray(settings.point_types) ? settings.point_types : [];
	if (!list.length) {
		// default behavior: show hp, hide nothing unless configured
		return new Set(["hp", "hwp"]);
	}

	const allowed = new Set();
	for (const row of list) {
		if (!row) continue;
		const typeId = (row.type_id || "").toString().trim();
		if (!typeId) continue;

		// Your UI uses points_log_type_id in each row as Yes/No (true/false)
		const show = isTruthy(row.points_log_type_id, false);
		if (show) allowed.add(typeId);
	}
	return allowed;
}

    /** Default points for users missing a stored value. */
    function getDefaultPoints() {
        return toInt(settings.default_points ?? settings.default_starting_points, 0);
    }

    /** Toggle profile points display. */
    function getShowOnProfile() {
        return isTruthy(settings.show_on_profile ?? settings.show_points_on_profiles, true);
    }

    /** Toggle mini-profile points display. */
    function getShowOnMini() {
        return isTruthy(settings.show_on_miniprofile ?? settings.show_points_on_miniprofiles, true);
    }

    /** Admin-controlled points log link text. */
    function getPointsLogLinkText() {
        const v = (settings.points_log_link_text ?? settings.points_log_label ?? "").toString().trim();
        return v || "Points Log";
    }

    /** Optional filter: point type id shown on log page. */
    function getPointsLogTypeId() {
        const v = (settings.points_log_type_id ?? settings.points_log_type ?? "").toString().trim();
        return v || "";
    }
    /* ---------------------------------------------------------
       UI Readers (Teams + Point Types)
       --------------------------------------------------------- */

    /** Read house/team config from plugin settings. */
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

    /** Read point types config (or fallback defaults). */
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
       Keys: Totals + User Points
       --------------------------------------------------------- */

    /** Raw totals key object. */
    function getTotalsRaw() {
        return safeObj(pb.plugin.key(KEY_TOTALS).get()) || {};
    }

    /**
     * Totals key structure:
     * { reset_version, reset_ts, by_group: {...}, log: [...] }
     */
    function getTotals() {
	const obj = getTotalsRaw();

	if (obj.by_group && typeof obj.by_group === "object") {
		return {
			reset_version: toInt(obj.reset_version, 0),
			reset_ts: toInt(obj.reset_ts, 0),
			by_group: safeObj(obj.by_group) || {},
			log: Array.isArray(obj.log) ? obj.log : [],
			notifs: Array.isArray(obj.notifs) ? obj.notifs : [] // <-- NEW
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

    /** Write totals key. */
    function setTotals(data, cb) {
	data.reset_ts = nowTs();
	if (!Array.isArray(data.log)) data.log = [];
	if (!Array.isArray(data.notifs)) data.notifs = []; // <-- NEW
	pb.plugin.key(KEY_TOTALS).set({
		value: data,
		success: function () { if (cb) cb(true); },
		error: function () { if (cb) cb(false); }
	});
}


    /** Read per-user points from user key. */
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
       Notifications Key (User Private)
       --------------------------------------------------------- */

    /** Resolve which notifications key exists (primary vs accidental fallback). */
    function resolveNotifsKey() {
        try { if (pb.plugin.key(KEY_NOTIFS_PRIMARY)) return KEY_NOTIFS_PRIMARY; } catch (e) {}
        try { if (pb.plugin.key(KEY_NOTIFS_FALLBACK)) return KEY_NOTIFS_FALLBACK; } catch (e) {}
        return null;
    }

    /**
     * Get notifications for a user.
     * Stored structure:
     * { reset_version, unread, items:[{ts, delta, type_id, abbr, reason, staff_id, staff_name, user_id, read}] }
     */
    function getNotifs(userId) {
	const keyName = resolveNotifsKey();
	if (!keyName) return { reset_version: 0, unread: 0, items: [] };

	const keyObj = pb.plugin.key(keyName);
	if (!keyObj || typeof keyObj.get !== "function") return { reset_version: 0, unread: 0, items: [] };

	const obj = safeObj(keyObj.get(userId)) || {};
	const items = Array.isArray(obj.items) ? obj.items : [];

	return {
		reset_version: toInt(obj.reset_version, 0),
		unread: countUnread(items),   // <— derived, not stored
		items
	};
}

    /** Set notifications for a user (always stamps current totals.reset_version). */
    function setNotifs(userId, data, cb) {
        const keyName = resolveNotifsKey();
        if (!keyName) { if (cb) cb(false); return; }

        const keyObj = pb.plugin.key(keyName);
        if (!keyObj || typeof keyObj.set !== "function") { if (cb) cb(false); return; }

        const totals = getTotals();
        const items = Array.isArray(data.items) ? data.items : [];
        const unread = Math.max(0, toInt(data.unread, 0));

        keyObj.set({
            object_id: userId,
            value: {
                reset_version: toInt(totals.reset_version, 0),
                unread,
                items
            },
            success: function () { if (cb) cb(true); },
            error: function () { if (cb) cb(false); }
        });
    }

    /**
     * Ensure notifications align with current reset_version.
     * If mismatch (admin reset), wipe them and return empty.
     */
    function ensureNotifsCurrent(userId, cb) {
        const totals = getTotals();
        const cur = getNotifs(userId);

        if (toInt(cur.reset_version, 0) !== toInt(totals.reset_version, 0)) {
            setNotifs(userId, { unread: 0, items: [] }, function () {
                if (cb) cb({ reset_version: totals.reset_version, unread: 0, items: [] });
            });
            return;
        }

        if (cb) cb(cur);
    }

    /** Push a new point notification to a user. */
    function pushNotif(userId, notif) {
	const keyName = resolveNotifsKey();
	if (!keyName) return;

	const keyObj = pb.plugin.key(keyName);
	if (!keyObj || typeof keyObj.get !== "function" || typeof keyObj.set !== "function") return;

	// Give new notif a unique id if missing (avoid same-second collisions)
	if (!notif || typeof notif !== "object") return;
	if (!notif.id) {
		notif.id = "hp_new_" + nowTs() + "_" + Math.random().toString(16).slice(2);
	}

	ensureNotifsCurrent(userId, function () {
		const raw = safeObj(keyObj.get(userId)) || {};
		const existingItems = Array.isArray(raw.items) ? raw.items : [];

		const CAP = 50;
		const mergedItems = mergeNotifs(notif, existingItems, CAP);

		const unread = countUnread(mergedItems);

		setNotifs(userId, { unread, items: mergedItems }, function () {
			const meId = getCurrentUserId();
			if (meId && meId === userId) {
				updateNotificationsIndicators();
				injectNotifsIntoNotificationsTab();
			}
		});
	});
}


    /** Mark all point notifications as read for a user. */
    function markAllNotifsRead(userId, cb) {
	const keyName = resolveNotifsKey();
	if (!keyName) { if (cb) cb(false); return; }

	const keyObj = pb.plugin.key(keyName);
	if (!keyObj || typeof keyObj.get !== "function") { if (cb) cb(false); return; }

	ensureNotifsCurrent(userId, function () {
		const raw = safeObj(keyObj.get(userId)) || {};
		const existingItems = Array.isArray(raw.items) ? raw.items : [];

		const items = ensureNotifIds(existingItems).map(n => Object.assign({}, n, { read: true }));
		setNotifs(userId, { unread: 0, items }, function () {
			if (cb) cb(true);
		});
	});
}



    /** Clear all point notifications for a user. */
    function clearNotifs(userId, cb) {
        setNotifs(userId, { unread: 0, items: [] }, function () {
            if (cb) cb(true);
        });
    }
    /* ---------------------------------------------------------
       Current User + Permissions
       --------------------------------------------------------- */

    /** Get current logged-in user info. */
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

    /** Current user id shortcut. */
    function getCurrentUserId() {
        const me = getCurrentUser();
        return me && me.id ? me.id : null;
    }

    /** Determine if the current user can edit another user's points. */
    function canEditUser(userId) {
        try { if (userId && pb.plugin.key(KEY_USER).can_write(userId)) return true; } catch (e) {}

        const allowed = normalizeGroupIds(settings.editor_group_ids);
        if (!allowed.length) return false;

        const meRaw = pb.data("user") || pb.data("current_user") || {};
        const myGroup = toInt(meRaw.group_id || meRaw.groupId || (meRaw.group && meRaw.group.id), -1);

        if (meRaw && (meRaw.is_admin === true || meRaw.isAdmin === true)) return true;
        return allowed.includes(myGroup);
    }

    /** Determine if the current user can edit totals/reset. */
    function canEditTotals() {
        try { return !!pb.plugin.key(KEY_TOTALS).can_write(); }
        catch (e) { return false; }
    }

    /* ---------------------------------------------------------
       Profile Meta Helpers
       --------------------------------------------------------- */

    /** Read user id + group id from profile meta placeholder. */
    function getProfileMeta() {
        const el = getProfileMetaEl();
        if (!el) return { userId: null, groupId: null };
        return {
            userId: toInt(el.getAttribute("data-user-id"), null),
            groupId: toInt(el.getAttribute("data-group-id"), null)
        };
    }

    /** Determine current profile user id (from meta or URL). */
    function getProfileUserId() {
        const meta = getProfileMeta();
        if (meta.userId) return meta.userId;

        const m = window.location.pathname.match(/\/user\/(\d+)/i);
        return m ? toInt(m[1], null) : null;
    }

    /** Build the per-user display points, respecting reset mismatch behavior. */
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
       Scoreboard Helpers / Rendering
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

    /** Render scoreboard row + link. */
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
    /* ---------------------------------------------------------
       Profile Rendering (with Edit Dialog)
       --------------------------------------------------------- */

    /** Default SVG for edit icon. */
    function defaultPencilSvg() {
        return (
            `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">` +
            `<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm2.92 2.83H5v-.92l8.06-8.06.92.92L5.92 20.08zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"></path>` +
            `</svg>`
        );
    }

    /** Render the edit icon (custom url or default SVG). */
    function editIconHTML() {
        const raw = settings.edit_icon;
        const url = (typeof raw === "string") ? raw.trim() : "";

        if (looksLikeUrl(url)) return `<img class="hp-edit-icon-img" src="${htmlEncode(url)}" alt="Edit">`;
        if (url && pluginImages[url]) return `<img class="hp-edit-icon-img" src="${htmlEncode(pluginImages[url])}" alt="Edit">`;

        return defaultPencilSvg();
    }

    /** Render points into the profile slot. */
    function renderProfile() {
        if (!getShowOnProfile()) return;

        const slot = getProfileSlotEl();
        if (!slot) return;

        const userId = getProfileUserId();
        if (!userId) return;

        const display = buildDisplayPoints(userId);
        const canEdit = canEditUser(userId);

        const rows = display.types.map(t => {
            const val = toInt(display.points[t.type_id], 0);
            const edit = canEdit ?
                  ` <a href="#" class="hp-edit" data-type="${htmlEncode(t.type_id)}" title="Edit ${htmlEncode(t.name)}">${editIconHTML()}</a>`
                : "";

            return `
<tr class="hp-row-item">
    <td class="headings">${htmlEncode(t.abbr)}:</td>
    <td>${val}${edit}</td>
</tr>
`;
        }).join("");

        const totalRow = (display.types.length > 1) ?
              `
<tr class="hp-row-item hp-total-row">
    <td class="headings">Total:</td>
    <td>${toInt(display.total, 0)}</td>
</tr>
`
            : "";

        slot.innerHTML = rows + totalRow;

        slot.onclick = function (e) {
            const link = e.target && (e.target.closest ? e.target.closest(".hp-edit") : null);
            if (!link) return;
            e.preventDefault();
            if (!canEdit) return;

            const typeId = link.getAttribute("data-type");
            if (!typeId) return;

            openAdjustDialog(userId, typeId);
        };
    }

    /** Open ProBoards dialog to adjust points with required reason. */
    function openAdjustDialog(userId, typeId) {
        const types = getPointTypes().filter(t => t.enabled);
        const t = types.find(x => x.type_id === typeId);
        if (!t) return;

        const totals = getTotals();
        const user = getUser(userId);

        const resetMismatch = (user.reset_version !== totals.reset_version);
        const currentVal = resetMismatch ? 0 : toInt(user.points[typeId], 0);

        const help = t.allow_negative ?
              `Enter a number to add or subtract (example: 10 or -5).`
            : `Enter a number to add (negative values are not allowed).`;

        const html = `
<div class="hp-dialog">
    <div class="hp-dialog-row">
        <label class="hp-dialog-label">${htmlEncode(help)}</label>
        <input id="hp-delta" type="text" value="" class="hp-dialog-input" placeholder="Points (ex: 10 or -5)">
    </div>

    <div class="hp-dialog-row">
        <label class="hp-dialog-label">Reason (required)</label>
        <input id="hp-reason" type="text" value="" class="hp-dialog-input hp-dialog-reason" placeholder="Example: 10 points for Charms Lesson 2 homework">
    </div>

    <div class="note">Current: ${currentVal}</div>
</div>
`;

        pb.window.dialog("hp-adjust-dialog", {
            title: `Adjust ${t.name} (${t.abbr})`,
            modal: true,
            width: 520,
            open: function () { $(this).html(html); },
            buttons: {
                "Save": function () {
                    const deltaRaw = document.getElementById("hp-delta").value;
                    const reason = (document.getElementById("hp-reason").value || "").trim();

                    if (!reason) {
                        pb.window.error("A reason is required to modify points.");
                        return;
                    }

                    let delta = toInt(deltaRaw, 0);
                    if (!t.allow_negative && delta < 0) delta = 0;

                    const newVal = Math.max(0, currentVal + delta);

                    pb.loading(null, true);
                    savePoint(userId, typeId, currentVal, newVal, delta, reason, function (ok, err) {
                        pb.loading(null, false);
                        if (!ok) {
                            pb.window.error(err || "Could not save points.");
                            return;
                        }
                        renderProfile();
                        renderMiniProfiles();
                        renderScoreboard();
                    });

                    $(this).dialog("close");
                },
                "Cancel": function () { $(this).dialog("close"); }
            }
        });
    }
    /* ---------------------------------------------------------
       Global Log + Saving Points
       --------------------------------------------------------- */

    /** Push a new entry into totals.log, capped to prevent key bloat. */
    function pushGlobalLogEntry(entry) {
        const totals = getTotals();
        const log = Array.isArray(totals.log) ? totals.log.slice() : [];
        log.unshift(entry);

        const CAP = 250;
        while (log.length > CAP) log.pop();

        totals.log = log;
        return totals;
    }
    // Add a point-change notification into hp_totals.notifs (global, staff-writable)
function pushGlobalNotifEntry(entry) {
	const totals = getTotals();
	const list = Array.isArray(totals.notifs) ? totals.notifs.slice() : [];
	list.unshift(entry);

	// cap to prevent key bloat
	const CAP = 500;
	while (list.length > CAP) list.pop();

	totals.notifs = list;
	return totals;
}

// Read a user's "last seen" timestamp from the user-private key.
// We no longer store per-item read flags. This is stable & reliable.
function getSeenState(userId) {
	const keyName = resolveNotifsKey();
	if (!keyName) return { reset_version: 0, seen_ts: 0 };

	const keyObj = pb.plugin.key(keyName);
	if (!keyObj || typeof keyObj.get !== "function") return { reset_version: 0, seen_ts: 0 };

	const obj = safeObj(keyObj.get(userId)) || {};
	return {
		reset_version: toInt(obj.reset_version, 0),
		seen_ts: toInt(obj.seen_ts, 0)
	};
}

// Write a user's "last seen" timestamp to the user-private key.
function setSeenState(userId, seenTs, cb) {
	const keyName = resolveNotifsKey();
	if (!keyName) { if (cb) cb(false); return; }

	const keyObj = pb.plugin.key(keyName);
	if (!keyObj || typeof keyObj.set !== "function") { if (cb) cb(false); return; }

	const totals = getTotals();

	keyObj.set({
		object_id: userId,
		value: {
			reset_version: toInt(totals.reset_version, 0),
			seen_ts: toInt(seenTs, 0)
		},
		success: function () { if (cb) cb(true); },
		error: function () { if (cb) cb(false); }
	});
}

// Ensure seen state matches current reset_version. If not, reset it.
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

// Get the last N notifications for a given user from totals.notifs
function getUserNotifsFromTotals(userId, limit) {
	const totals = getTotals();
	const list = Array.isArray(totals.notifs) ? totals.notifs : [];
	const uid = toInt(userId, 0);

	const filtered = list.filter(n => n && toInt(n.user_id, 0) === uid);
	return filtered.slice(0, Math.max(0, toInt(limit, 10)));
}

	// Best-effort: get the displayed profile name when we're on a profile page
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

	// fallback: pull from visible profile header if present
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
    /**
     * Save point change:
     * - updates hp_user
     * - updates hp_totals (by_group + log)
     * - pushes per-user notification (hp_notifications)
     */
    function savePoint(userId, typeId, oldVal, newVal, delta, reason, done) {
	const totals = getTotals();
	const user = getUser(userId);
	const meta = getProfileMeta();

	const groupId = (meta.userId === userId && meta.groupId) ? meta.groupId : (user.group_id || meta.groupId);
	if (!groupId) {
		if (done) done(false, "Missing group id. Make sure hp-profile-meta is in the profile template.");
		return;
	}

	const types = getPointTypes().filter(t => t.enabled);
	const resetMismatch = (user.reset_version !== totals.reset_version);

	// Write all enabled types explicitly
	const newPoints = {};
	for (const t of types) {
		const base = resetMismatch ? 0 : toInt(user.points[t.type_id], 0);
		newPoints[t.type_id] = base;
	}
	newPoints[typeId] = toInt(newVal, 0);

	// Update group totals
	const byGroup = safeObj(totals.by_group) || {};
	const gk = String(groupId);
	const groupTotals = safeObj(byGroup[gk]) || {};

	const d = toInt(newVal, 0) - toInt(oldVal, 0);
	groupTotals[typeId] = toInt(groupTotals[typeId], 0) + d;
	byGroup[gk] = groupTotals;

	pb.plugin.key(KEY_USER).set({
		object_id: userId,
		value: {
			reset_version: totals.reset_version,
			group_id: groupId,
			points: newPoints,
			updated: nowTs()
		},
		success: function () {
			const pt = types.find(x => x.type_id === typeId) || { type_id: typeId, abbr: typeId.toUpperCase(), name: typeId };
			const me = getCurrentUser();

			// Gate global log by per-type "Show on Log" UI option
			const allowedLogTypes = getLogEnabledTypeIds();

			let newTotalsPayload = {
				reset_version: totals.reset_version,
				reset_ts: totals.reset_ts,
				by_group: byGroup,
				log: Array.isArray(totals.log) ? totals.log : [],
				notifs: Array.isArray(totals.notifs) ? totals.notifs : [] // <-- NEW global notifs feed
			};

			const positiveDelta = toInt(delta, 0);

			// Capture a best-effort display name for immediate log entry,
			// but log page will live-update later via fetchLiveDisplayName.
			let targetName = getDisplayedProfileNameFor(userId);
			if (!targetName) targetName = `User #${toInt(userId, 0)}`; // never store blank

			// Only store positive awards on the global log and only if this type is enabled for the log
			if (positiveDelta > 0 && allowedLogTypes.has(String(typeId))) {
				const entry = {
					ts: nowTs(),
					delta: positiveDelta,
					type_id: pt.type_id,
					abbr: pt.abbr,
					reason: reason,
					staff_id: me.id || 0,
					staff_name: me.name || "Staff",
					user_id: userId,
					user_name: targetName || ""
				};

				const patchedTotals = pushGlobalLogEntry(entry);
				newTotalsPayload.log = patchedTotals.log;
			}

			// Always add to global notifications feed (awards AND deductions)
			const notifEntry = {
				ts: nowTs(),
				delta: toInt(delta, 0),
				type_id: pt.type_id,
				abbr: pt.abbr,
				reason: reason,
				staff_id: me.id || 0,
				staff_name: me.name || "Staff",
				user_id: userId
			};

			const patchedTotalsForNotifs = pushGlobalNotifEntry(notifEntry);
			newTotalsPayload.notifs = patchedTotalsForNotifs.notifs;

			// Save totals (including log + global notifications)
			setTotals(newTotalsPayload, function (ok) {
				if (!ok) {
					if (done) done(false, "Failed writing totals key (check totals key permissions).");
					return;
				}

				// Update indicators for the CURRENT user (if they are the one receiving points)
				// Actual "read/unread" is handled via seen_ts when they view the notifications tab.
				const meId = getCurrentUserId();
				if (meId && toInt(meId, 0) === toInt(userId, 0)) {
					updateNotificationsIndicators();
					injectNotifsIntoNotificationsTab();
				}

				if (done) done(true);
			});
		},
		error: function () {
			if (done) done(false, "Failed writing user key (check user key permissions).");
		}
	});
}



    /* ---------------------------------------------------------
       Mini-profile Rendering
       --------------------------------------------------------- */

    /** Render mini-profile points blocks on pages with mini profiles. */
    function renderMiniProfiles() {
        if (!getShowOnMini()) return;

        const minis = document.querySelectorAll(".mini-profile");
        if (!minis.length) return;

        const enabled = getPointTypes().filter(t => t.enabled);

        minis.forEach(mini => {
            const slot = mini.querySelector(".hp-mini-slot");
            if (!slot) return;

            const a = mini.querySelector("a[href*='/user/']");
            if (!a) return;

            const m = a.getAttribute("href").match(/\/user\/(\d+)/i);
            const userId = m ? toInt(m[1], null) : null;
            if (!userId) return;

            const display = buildDisplayPoints(userId);

            const lines = enabled.map(t => {
                const v = toInt(display.points[t.type_id], 0);
                return `<div class="hp-mini-line"><span class="hp-mini-abbr">${htmlEncode(t.abbr)}:</span> <span class="hp-mini-val">${v}</span></div>`;
            }).join("");

            slot.innerHTML = `<div class="hp-mini">${lines}</div>`;
        });
    }
    /* ---------------------------------------------------------
       Reset UI
       --------------------------------------------------------- */

    /** Render reset UI (only where #hp-reset-ui exists). */
    function injectResetUI() {
        const host = getResetHostEl();
        if (!host) return;

        if (!canEditTotals()) {
            host.innerHTML = `<div class="note">You do not have permission to reset totals.</div>`;
            return;
        }

        if (host.getAttribute("data-ready") === "1") return;
        host.setAttribute("data-ready", "1");

        host.innerHTML = `
<div class="hp-reset-box">
    <div class="hp-reset-title">Reset Points</div>
    <div class="hp-reset-text">
        This resets the scoreboard totals and clears the global Points Log.
        You will be asked to type <strong>RESET</strong> to confirm.
    </div>
    <div class="hp-reset-actions">
        <button class="button" id="hp-reset-btn">Reset All Points</button>
        <span class="hp-reset-status note" id="hp-reset-status"></span>
    </div>
</div>
`;

        const btn = document.getElementById("hp-reset-btn");
        if (!btn) return;

        btn.addEventListener("click", function (e) {
            e.preventDefault();

            const totals = getTotals();
            const nextVersion = toInt(totals.reset_version, 0) + 1;

            const teams = getHouseTeamList();
            const types = getPointTypes().filter(t => t.enabled);

            const by_group = {};
            for (const ht of teams) {
                const gk = String(ht.group_id);
                by_group[gk] = {};
                for (const t of types) by_group[gk][t.type_id] = 0;
            }

            pb.form.gen_verify_box(
                "hp-reset-verify",
                "Reset All Points",
                "240",
                "520",
                "This will reset all scoreboard totals AND clear the global log. Type RESET to confirm.",
                "RESET",
                "Reset",
                function () {
                    pb.loading(null, true);
                    setTotals({
                        reset_version: nextVersion,
                        reset_ts: nowTs(),
                        by_group: by_group,
                        log: []
                    }, function (ok) {
                        pb.loading(null, false);
                        const status = document.getElementById("hp-reset-status");
                        if (status) status.textContent = ok ? "Reset complete." : "Reset failed (check totals key permissions).";

                        // Current user: clear point notifications immediately (everyone else clears on next visit via reset_version mismatch)
                        const me = getCurrentUser();
                        if (me && me.id) {
                            clearNotifs(me.id, function () {
                                updateNotificationsIndicators();
                                injectNotifsIntoNotificationsTab();
                            });
                        }

                        renderScoreboard();
                        renderProfile();
                        renderMiniProfiles();
                    });
                }
            );
        });
    }

    /* ---------------------------------------------------------
       Points Log Page (?points)
       --------------------------------------------------------- */

    /** Render the global Points Log page for all users. */
    function renderPointsLogPage() {
	if (!isPointsLogPage()) return;

	const me = getCurrentUser();
	if (!me || !me.id) return;

	const $content = $("#content");
	if ($content.length) $content.children().hide();

	const totals = getTotals();
	const log = Array.isArray(totals.log) ? totals.log.slice() : [];

	// Only show point types that are enabled for the log in the Point Types autoform
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
</tr>
`;
	}).join("");

	const backUrl = (function () {
		try {
			const url = new URL(window.location.href);
			url.searchParams.delete("points");
			return url.pathname + (url.search || "");
		} catch (e) {
			return window.location.pathname;
		}
	})();

	const title = getPointsLogLinkText();

	// Build a friendly note listing the allowed point type abbreviations (if available)
	let typeNote = "Showing positive awards for enabled point types.";
	try {
		const pts = getPointTypes().filter(t => allowedLogTypes.has(String(t.type_id)));
		if (pts.length) {
			typeNote = "Showing positive awards for: <strong>" + pts.map(t => htmlEncode(t.abbr || t.type_id)).join(", ") + "</strong>.";
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
</div>
`;

	$content.append($(html).show());

	// Live-update names after render (reflect display name changes)
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

    /* ---------------------------------------------------------
       Notifications Tab Integration
       --------------------------------------------------------- */

    /** Detect if we are on /user/{id}/notifications. */
    function isOnProfileNotificationsTab() {
        return /\/user\/\d+\/notifications/i.test(window.location.pathname);
    }

    /** Locate the built-in notifications table body. */
    function findNotificationsTableBody() {
        const table =
            document.querySelector(".show-user table.list") ||
            document.querySelector("#content .show-user table.list") ||
            document.querySelector("#content table.list");

        if (!table) return null;
        return table.querySelector("tbody") || null;
    }

    /**
     * Inject point notifications into the user's Notifications tab,
     * matching the built-in table row layout:
     * Left = message, Right = date.
     */
    function injectNotifsIntoNotificationsTab() {
	if (!isOnProfileNotificationsTab()) return;

	const me = getCurrentUser();
	if (!me || !me.id) return;

	const tbody = findNotificationsTableBody();
	if (!tbody) return;

	tbody.querySelectorAll("tr.hp-notif-injected-row").forEach(r => r.remove());

	ensureSeenCurrent(me.id, function (st) {
		const seenTs = toInt(st.seen_ts, 0);
		const items = getUserNotifsFromTotals(me.id, 10);

		const templateRow = tbody.querySelector("tr") ? tbody.querySelector("tr").cloneNode(true) : null;

		let newestTsOnPage = seenTs;
		const rows = items.map(n => {
			const pts = toInt(n.delta, 0);
			const sign = pts >= 0 ? "+" : "";
			const abbr = htmlEncode(n.abbr || n.type_id || "");
			const reason = htmlEncode(n.reason || "");
			const staffName = htmlEncode(n.staff_name || "Staff");
			const dateText = htmlEncode(formatDateNoTime(toInt(n.ts, 0)));

			const isNew = toInt(n.ts, 0) > seenTs;
			if (toInt(n.ts, 0) > newestTsOnPage) newestTsOnPage = toInt(n.ts, 0);

			const newBadge = isNew ? `<span class="new-icon">NEW</span> ` : "";
			const msg = `${newBadge}<strong>${abbr}:</strong> ${sign}${pts} for ${reason} by ${staffName}`;

			let tr;
			if (templateRow) {
				tr = templateRow.cloneNode(true);
				tr.querySelectorAll("td").forEach(td => td.innerHTML = "");

				const tds = tr.querySelectorAll("td");
				if (tds.length >= 2) {
					tds[0].innerHTML = msg;
					tds[1].innerHTML = dateText;
				} else if (tds.length === 1) {
					tds[0].innerHTML = `${msg}<div style="float:right">${dateText}</div>`;
				} else {
					tr.innerHTML = `<td>${msg}</td><td>${dateText}</td>`;
				}
			} else {
				tr = document.createElement("tr");
				tr.innerHTML = `<td>${msg}</td><td>${dateText}</td>`;
			}

			tr.classList.add("hp-notif-injected-row");
			return tr;
		});

		for (let i = rows.length - 1; i >= 0; i--) {
			tbody.insertBefore(rows[i], tbody.firstChild);
		}

		// Mark "seen" to the newest notification shown (clears bubble + "(#)")
		// Delay slightly so NEW badges are visible briefly.
		window.setTimeout(function () {
			setSeenState(me.id, newestTsOnPage || nowTs(), function () {
				updateNotificationsIndicators();
			});
		}, 250);
	});
}


    /* ---------------------------------------------------------
       NAV Bubble (Theme tip-holder) + Profile Tab "(#)"
       --------------------------------------------------------- */

    /** Find the top navigation link that goes to /user/{currentUserId}. */
    function findTopNavProfileLink() {
        const me = getCurrentUser();
        if (!me || !me.id) return null;

        const myPath = `/user/${toInt(me.id, 0)}`;

        function hrefPath(a) {
            const raw = (a.getAttribute("href") || "").trim();
            if (!raw) return "";
            try { return new URL(raw, window.location.origin).pathname; }
            catch (e) { return raw; }
        }

        const all = document.querySelectorAll("ul[role='navigation'] a[href], nav a[href], #navigation-menu a[href], a[href]");
        for (const a of all) {
            if (a.closest && a.closest(".show-user")) continue;
            const p = hrefPath(a);
            if (p === myPath || p === `${myPath}/`) return a;
        }

        // Fallback: /user root if a theme uses that
        for (const a of all) {
            if (a.closest && a.closest(".show-user")) continue;
            const p = hrefPath(a);
            if (p === "/user" || p === "/user/") return a;
        }

        return null;
    }

    /**
     * Update the nav bubble using your theme structure:
     * <div class="tip-holder"><div class="tip-number">#</div><span class="tip"></span></div>
     */
    function updateProfileNavBubbleOnly(unread) {
        const a = findTopNavProfileLink();
        if (!a) return;

        let holder = a.querySelector(".tip-holder");
        let number = holder ? holder.querySelector(".tip-number") : null;

        if (!unread || unread <= 0) {
            if (holder) holder.remove();
            return;
        }

        if (!holder) {
            holder = document.createElement("div");
            holder.className = "tip-holder";

            number = document.createElement("div");
            number.className = "tip-number";
            holder.appendChild(number);

            const tip = document.createElement("span");
            tip.className = "tip";
            holder.appendChild(tip);

            holder.onclick = function (e) {
                e.preventDefault();
                e.stopPropagation();
                window.location = a.getAttribute("href") || "/user";
                return false;
            };

            a.appendChild(holder);
        }

        number.textContent = String(unread);
    }

    /** Store original Notifications tab label and add "(#)" when needed. */
    function setParenCountOnNotificationsTabLink(a, unread) {
        if (!a) return;

        if (!a.getAttribute("data-hp-orig")) {
            const base = (a.textContent || "").replace(/\s*\(\d+\)\s*$/, "").trim();
            a.setAttribute("data-hp-orig", base || "Notifications");
        }

        const baseLabel = a.getAttribute("data-hp-orig") || "Notifications";

        if (!unread || unread <= 0) {
            a.textContent = baseLabel;
            return;
        }

        a.textContent = `${baseLabel} (${unread})`;
    }

    /** Find the Notifications tab link on a user's profile page. */
    function findProfileNotificationsTabLink() {
        const tabs = document.querySelectorAll(".show-user a");
        let best = null;

        tabs.forEach(a => {
            const href = (a.getAttribute("href") || "");
            const text = (a.textContent || "").trim().toLowerCase();

            if (/\/user\/\d+\/notifications/i.test(href) || text === "notifications") {
                best = best || a;
            }
        });

        return best;
    }

    /**
     * Update:
     * - top nav bubble
     * - profile Notifications tab "(#)"
     */
    function updateNotificationsIndicators() {
	const me = getCurrentUser();
	if (!me || !me.id) return;

	ensureSeenCurrent(me.id, function (st) {
		const seenTs = toInt(st.seen_ts, 0);
		const items = getUserNotifsFromTotals(me.id, 200); // check last 200 for unread count

		const unread = items.reduce((acc, n) => acc + ((toInt(n.ts, 0) > seenTs) ? 1 : 0), 0);

		updateProfileNavBubbleOnly(unread);

		const tabLink = findProfileNotificationsTabLink();
		if (isOnProfileNotificationsTab()) {
			setParenCountOnNotificationsTabLink(tabLink, 0);
		} else {
			setParenCountOnNotificationsTabLink(tabLink, unread);
		}
	});
}
    /* ---------------------------------------------------------
       Init / Page Hooks
       --------------------------------------------------------- */

    /** Initialize plugin behavior and re-render on page changes. */
    function init() {
        renderScoreboard();
        renderProfile();
        renderMiniProfiles();
        injectResetUI();

        updateNotificationsIndicators();
        injectNotifsIntoNotificationsTab();
        renderPointsLogPage();

        pb.events.on("pageChange", function () {
            renderScoreboard();
            renderProfile();
            renderMiniProfiles();

            const host = getResetHostEl();
            if (host) host.removeAttribute("data-ready");
            injectResetUI();

            updateNotificationsIndicators();
            injectNotifsIntoNotificationsTab();

            renderPointsLogPage();
        });

        pb.events.on("afterSearch", function () {
            renderMiniProfiles();
        });
    }

    $(init);
})();
