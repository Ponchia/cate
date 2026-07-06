---
name: cate-cli
description: Drive the Cate IDE from inside a Cate terminal with the `cate` CLI — control the built-in browser panel (open URLs, navigate, screenshot, read an accessibility snapshot, click and type by ref) and call any cate.* host method. Use when an agent or user working in a Cate terminal needs to see or steer a web page, capture a screenshot, or reach Cate's host API from the shell.
user-invocable: true
---

# Driving Cate from the terminal with `cate`

`cate` is a small CLI, preinstalled on PATH **inside Cate terminals and Cate
agent shells**. It lets you control Cate — its browser panels, plus each `cate.*`
host scope through a matching command group (`workspace`, `theme`, `ui`,
`editor`, `canvas`, `panel`, `agent`, `storage`) — and reach any host method
directly via `cate api`. It talks to a per-workspace loopback endpoint Cate
injects as `CATE_API` + `CATE_TOKEN`.

**It only works inside a Cate terminal.** Outside one those env vars are unset
and every command exits `3` with `not running inside a Cate terminal`. There is
nothing to install or configure.

## Browser control

A Cate window can host browser panels. These verbs act on the **active** browser
panel by default; target a specific one with `--panel <id>` (get ids from
`cate browser list`).

```bash
cate browser list                 # one panel per line: id, url, title
cate browser open https://x.com   # navigate; prints the resulting url
cate browser current              # current url
cate browser back                 # history back;  prints url
cate browser forward              # history forward
cate browser reload               # reload
cate browser screenshot           # prints ONLY a file path (see below)
cate browser snapshot             # accessibility tree with refs (see below)
cate browser click e12            # click the element with ref e12
cate browser type e7 hello world  # type text into the element with ref e7
```

### Reading a screenshot

`cate browser screenshot` prints a single line: the path to a PNG on disk.
Nothing else goes to stdout. Read that file to see the page:

```bash
shot=$(cate browser screenshot)
# now view "$shot" (e.g. open it, or read it as an image)
```

### Reading a snapshot, then acting

`cate browser snapshot` prints a compact accessibility view: a `url:` line, a
`title:` line, then one line per interactive element:

```
url: https://example.com
title: Example
[e12] link "Home"
[e13] button "Sign in"
[e14] textbox "Search"
```

The bracketed token (`e12`) is the element's **ref**. Feed it back to `click`
or `type`:

```bash
cate browser click e13            # click "Sign in"
cate browser type e14 mechanical keyboards
```

Typical loop: `snapshot` to find a ref → `click`/`type` → `snapshot` again (or
`screenshot`) to confirm the result.

## Host API groups

Every `cate.*` scope has its own command group with named verbs, so common calls
need no JSON. Each maps one-to-one onto a host method:

```bash
cate workspace get                # -> { rootPath, branch, worktree }
cate theme get                    # -> the active theme tokens
cate ui notify build finished     # OS notification; trailing words are the message
cate editor open src/app.ts       # open a file in an editor panel
cate canvas create terminal       # open a new panel of the given type
cate panel set-title My Panel     # rename the calling panel

cate storage get <key>            # read this extension's stored value
cate storage set <key> <value>    # value is parsed as JSON, else stored as a string
cate storage delete <key>
cate storage keys                 # one key per line

cate agent run fix the failing test   # one-shot: open -> send -> dispose; prints the reply
cate agent open [resume]              # start/resume a session; prints its handle
cate agent send <handle> <prompt...>  # one turn on an open session; prints the reply
cate agent dispose <handle>
cate agent cancel                     # abort the in-flight turn
```

Values in `storage set` are JSON when they parse (`5`, `true`, `{"a":1}`) and a
raw string otherwise (`alice`). `agent`/`browser`/`storage`/etc. each require the
matching host scope; inside a trusted Cate terminal that's already granted.

## The `cate api` escape hatch

Any host method is reachable directly, whether or not a group verb exists for
it. The `cate.` prefix is optional; args are a JSON object (positional or piped
on stdin, default `{}`):

```bash
cate api version                            # -> 2
cate api workspace.get
cate api cate.ui.notify '{"message":"done"}'
echo '{"url":"https://x.com"}' | cate api browser.open
```

Group commands are just sugar over this: `cate browser open URL` sends
`cate.browser.open` with `{"url":"URL"}`.

## Flags

- `--panel <id>` — target a specific panel (sets `args.panelId`).
- `--json` — print the raw unwrapped result as one JSON line (nothing else on
  stdout). Use this when you want to parse the output.
- `--timeout <ms>` — request timeout (default 30000).
- `-h`, `--help` — usage.
- `--version` — the CLI's own version.

## Output and exit codes

- Human output goes to **stdout**; diagnostics go to **stderr**.
- `0` — success.
- `1` — the call reported an error. Message: `cate: <method>: <error>` (e.g.
  `cate: cate.browser.click: no-such-browser`). This covers both an HTTP error
  response and an in-band `{result:{error}}`.
- `2` — usage error (unknown command/verb, missing argument, bad JSON).
- `3` — not inside a Cate terminal, or the request could not reach Cate.

Check `$?` (or catch a non-zero exit) rather than scraping stderr.
