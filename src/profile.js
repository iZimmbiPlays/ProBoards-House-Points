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

/**
 * Render points into the profile slot (Summary tab),
 * and attach edit handlers (for allowed staff).
 */
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

/**
 * Open ProBoards dialog to adjust points with required reason.
 * Calls savePoint(...) on submit.
 */
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
