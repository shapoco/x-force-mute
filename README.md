# X Force Mute

[日本語版 README](README.ja.md)

A [Tampermonkey](https://www.tampermonkey.net/) user script that hides posts on **X (Twitter)** by screen name, keyword, or regular expression.

X has a built-in mute feature, but it does not apply to **Lists** — muted users still show up there. This script hides them anyway, on every timeline.

## Features

- Mute by **screen name** (`@example`) or by **keyword / regular expression** matched against the post body.
- Works everywhere, including **Lists**, Home, Search and profile timelines.
- Reposts and quote posts are covered as well:
  - a repost by a muted user is hidden,
  - a repost **of** a muted user is hidden,
  - if the **quoted** post matches, the quoting post is hidden together with it.
- On a muted user's **profile page** (`x.com/username`), that user's own `@username` rule is ignored so their posts stay visible — if you went there on purpose, nothing is hidden.
- Settings UI is reachable from a 🙈 button in the bottom-right corner of the page.
- Rules are stored in the user script manager, so they survive reloads; the script never sends them anywhere (see Notes).

## Installation

1. Install a user script manager. [Tampermonkey](https://www.tampermonkey.net/) is recommended; Violentmonkey works as well.
2. Open the script and let the manager install it:

   **[Install x-force-mute.user.js](https://raw.githubusercontent.com/shapoco/x-force-mute/main/dist/x-force-mute.user.js)**

   (The source is at [`dist/x-force-mute.user.js`](https://github.com/shapoco/x-force-mute/blob/main/dist/x-force-mute.user.js) if you want to read it first.)
3. Confirm the installation dialog, then reload X.

## Usage

1. Open [x.com](https://x.com/) and click the **🙈 button in the bottom-right corner** of the page.
2. Enter your mute rules in the text box, **one rule per line**.
3. Press **Save**. The timeline is filtered immediately — no reload needed.

`Cancel` closes the dialog and discards your edits. <kbd>Esc</kbd> also closes it, and <kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves.

The 🙈 button gets a blue outline while any rule is active, and its tooltip shows how many posts are currently hidden on the page.

### Rule syntax

| Line | Meaning |
| --- | --- |
| `@screen_name` | Hide posts by this user. Also matches the user who reposted, and the author of a quoted post. Case-insensitive. |
| `/regexp/` | Hide posts whose body matches this regular expression. With no flags, `i` (case-insensitive) is used. |
| `/regexp/flags` | Same, with explicit [JavaScript regexp flags](https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/RegExp) (`g` and `y` are ignored). |
| anything else | Hide posts whose body contains this text. Case-insensitive. |

Blank lines are ignored. A `@` line only needs the screen name — anything after it (`/status/...`, query strings, etc.) is discarded, so pasting a profile URL fragment is fine.

### Example

```
@spam_account
@another_user
buy now
/(?:BREAKING|Please retweet)/
/^\s*GM\s*$/i
```

This hides everything posted (or reposted, or quoted) by `@spam_account` and `@another_user`, anything containing `buy now` in any casing, anything mentioning `BREAKING` or `Please retweet`, and posts whose body is just `GM`.

## Notes

- Keyword and regular expression rules are matched against the **post body only** (the text of the post plus the text of a quoted post) — not against display names, alt text, or link previews.
- Matching runs on what is rendered in the page, so a post is hidden the moment it appears in the timeline. Nothing is reported to X: the posts are simply not displayed.
- Rules are saved per browser profile through the user script manager's storage (`GM_setValue`), falling back to `localStorage`.
- This script never sends your rules off your device. They are stored in the browser only.
- The safety of the stored rules (e.g. whether other scripts or extensions can read them, or whether they get synced elsewhere) is subject to the security of your browser and your user script manager (extension).

## License

MIT
