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

/**
 * Determine which point types are allowed to display on the Points Log.
 * Uses the Point Types autoform row field: points_log_type_id (Yes/No).
 */
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

/** Optional filter: point type id shown on log page (legacy/optional). */
function getPointsLogTypeId() {
    const v = (settings.points_log_type_id ?? settings.points_log_type ?? "").toString().trim();
    return v || "";
}
