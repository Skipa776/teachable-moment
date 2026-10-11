# Teachable Moment

A Claude Code mod for junior developers. Step through every edit Claude made in this session, and ask a Teacher subagent to explain any one edit, or everything changed in one turn.

Based on Replay Theater from [anthropics/claude-code-playground](https://github.com/anthropics/claude-code-playground) (Apache-2.0).

## What it does

- Recording is on from the start of the session. It records `Edit`, `Write` and `MultiEdit` calls made by the main loop and by subagents (only edits that succeeded). The Teacher's own loops are never recorded.
- Edits are committed as a group when their loop's turn completes: the main loop's at the end of its turn (labelled `turn N`), and each subagent's at the end of that subagent's own turn (labelled `turn N · <agent type>`, for example `turn 5 · savvy-careful`; `subagent` if the type is unknown). One counter numbers all groups. Edits of a subagent that never finishes its turn are not shown.
- All edits of the session are kept, up to 200 (oldest dropped first). Browsing order is newest group first; within a group, the order the edits were made.
- A band above the prompt shows `🎓 Teachable Moment: N edits (press t)` with a **Teach** button.
- The pane shows the step strip, the file, the tool, the `+`/`-` counts and the diff (up to 12 lines). The header shows the group label and position, for example `turn 5 · savvy-careful · step 2 of 7`. Its buttons are **Prev**, **Next**, **Explain edit**, **Explain turn** and **Close**.
- **Explain edit** starts the Teacher subagent on the step you are viewing. It is read-only (Read, Grep, Glob) and answers in two parts: a **High level** section (1 to 6 sentences on what the change contributes and why it matters) and a **Low level** section (how the code works, with one small example). Answers are cached per step. If the Teacher fails or takes more than 120 seconds, the button becomes **Retry**.
- **Explain turn** asks the Teacher about every edit in the current step's group at once: the High level section (2 to 8 sentences) says what the changes build together and how the pieces fit, and the Low level section walks through how the files work together, with one small example. The Teacher gets all the diffs, sharing a budget of about 400 diff lines, and may read the full files. The view header says `This turn · K files` (or `This edit`) and the answer is cached per group. The timeout is 180 seconds, then the button becomes **Retry**.
- Pressing a button whose answer is already cached (or being fetched) just switches the view, without a new Teacher run. Prev and Next keep the chosen view.
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
| `/teach off` | Pause recording (main loop and subagents); edits made while off are never recorded |
| `/teach on` | Resume recording |

Hotkeys: in the band, `t` opens the pane. In the pane, `p` previous, `n` next, `e` explain edit (or retry), `x` explain turn (or retry), `c` close, and `u` / `d` scroll a long explanation. Escape closes the pane.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `teacherModel` | `claude-sonnet-5-5` | Model the Teacher subagent runs on |

Set it in the plugin config menu, or in settings under `pluginConfigs["teachable-moment"].options`.

## Privacy and cost

- Only edits made while recording is on are recorded. The record is kept in memory only, and it is not added to the model's context.
- Recorded steps live only in memory: they are gone when the session ends or the mod reloads.
- Each **Explain edit** or **Explain turn** is one Teacher subagent run, billed like any other subagent run. A turn run reads more, so it costs more.

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
