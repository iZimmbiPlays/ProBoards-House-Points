# House Points Plugin (ProBoards)

A fully featured **House / Team Points system** for ProBoards forums, designed for roleplay communities, schools, competitions, and gamified communities.

This plugin provides:
- Automatic house / team scoreboards
- Per-user point tracking
- Staff-controlled point awards
- A global Points Log page
- Native-style notifications with nav bubbles
- Safe global resets with versioning
- A modular, developer-friendly source structure

---

## Installation

1. Download **`HousePoints.pbp`** from this repository.
2. Go to **Admin Dashboard → Plugins → Import Plugin**.
3. Upload the `.pbp` file.
4. Configure plugin **Settings**, **Keys**, and **Templates** as outlined below.

> ProBoards requires a single compiled `.pbp` file.  
> The `/src` folder is for development and documentation only.

---

## Required Template Placeholders

### 1️⃣ Profile (Summary Tab)

Required to display user points and allow staff editing.

```html
<div id="hp-profile-meta"
     data-user-id="$[user.id]"
     data-group-id="{if $[user.group]}$[user.group.id]{else}0{/if}">
</div>

<tbody id="hp-profile-slot"></tbody>

```
### 2️⃣ Mini-Profile (Optional)
```html
<div class="hp-mini-slot"></div>
```
### 3️⃣ Admin Reset Points UI (Optional)

Only required on pages where you want staff, preferably admins to be able to reset points. It is suggested that you make a hidden board that only administrators have access to and place this code in the Header for that board.
```html
<div id="hp-reset-ui"></div>
```
---

Scoreboard

- The scoreboard is automatically injected by the plugin
- No board header or footer placeholders are required
- You choose which board it appears on via plugin settings

Supports:

- Team images
- Optional team name labels
- Multiple point types
