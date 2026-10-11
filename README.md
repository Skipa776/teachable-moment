# Teachable Moment

A Claude Code mod for junior developers. Step through every edit Claude made in this session, and ask a Teacher subagent to explain any one of them.

Based on Replay Theater from [anthropics/claude-code-playground](https://github.com/anthropics/claude-code-playground) (Apache-2.0).

## What it does

- Recording is on from the start of the session. It records `Edit`, `Write` and `MultiEdit` calls made by the main loop. Edits made inside subagents, including the Teacher, are skipped. Edits are committed when the turn completes.
- All edits of the session are kept, up to 200 (oldest dropped first). Browsing order is newest turn first; within a turn, the order the edits were made.
- A band above the prompt shows `🎓 Teachable Moment: N edits (press t)` with a **Teach** button.
- The pane shows the step strip, the file, the tool, the `+`/`-` counts and the diff (up to 12 lines). Its buttons are **Prev**, **Next**, **Explain this** and **Close**.
- **Explain this** starts the Teacher subagent. It is read-only (Read, Grep, Glob) and answers in two parts: a **High level** section (1 to 6 sentences on what the change contributes and why it matters) and a **Low level** section (how the code works, with one small example). Answers are cached per step. If the Teacher fails or takes more than 120 seconds, the button becomes **Retry**.
- The Teacher runs on Sonnet 5.5 by default (`claude-sonnet-5-5`). It is hidden from the main model and is never offered to it.

## Install

```
/plugin install teachable-moment --marketplace Skipa776/teachable-moment
```

When prompted, answer `y` to add the marketplace, then pick the user scope.

## Usage

| Command | Does |
| --- | --- |
| `/teach` | Open the pane (or say that nothing is recorded yet) |
| `/teach off` | Pause recording; edits made while off are never recorded |
| `/teach on` | Resume recording |

Hotkeys: in the band, `t` opens the pane. In the pane, `p` previous, `n` next, `e` explain (or retry), `c` close, and `u` / `d` scroll a long explanation. Escape closes the pane.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `teacherModel` | `claude-sonnet-5-5` | Model the Teacher subagent runs on |

Set it in the plugin config menu, or in settings under `pluginConfigs["teachable-moment"].options`.

## Privacy and cost

- Only edits made while recording is on are recorded. The record is kept in memory only, and it is not added to the model's context.
- Recorded steps live only in memory: they are gone when the session ends or the mod reloads.
- Each **Explain this** is one Teacher subagent run, billed like any other subagent run.

## Works alongside Replay Theater

Teachable Moment draws its band and pane next to Replay Theater's. Both can be installed at the same time.

## Development

```
claude --plugin-dir .
claude plugin validate .
claude plugin test .
```

The source is `hooks/teachable-moment.ts`, with tests in `tests/teachable-moment.test.ts`.

## Credits

Based on Replay Theater from [anthropics/claude-code-playground](https://github.com/anthropics/claude-code-playground), Copyright 2026 Anthropic PBC, licensed under the Apache License 2.0. See [NOTICE](NOTICE).

## License

Apache License 2.0. See [LICENSE](LICENSE).
