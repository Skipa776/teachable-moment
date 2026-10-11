import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { State } from '../hooks/teachable-moment'
import { allocateBudget, cleanText, commitDrafts, explanationFor, isOurs, orderSteps, parseExplanation, wrapText } from '../hooks/teachable-moment'

const PLUGIN = 'teachable-moment'
const PANE_PROPS = {
  title: 'Teachable Moment', isFocused: true, bodyColumns: 72, placement: 'inline',
  scroll: { offset: 0, bodyRows: 30 }, view: {},
} as const
const BAND_PROPS = {
  hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {},
} as const

// What the engine does beneath the plugin: let every call through and collect
// the prompts of the Teacher spawns.
function engineBeneath(on: On, bandText = '', holdSecondSpawn?: Promise<void>) {
  const spawned: string[] = []
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('agent.register', () => ({ value: { agent: 'teachable-moment:teacher' } }))
  on('agent.spawn', async (_$, e) => {
    spawned.push(e.prompt)
    if (spawned.length === 2) await holdSecondSpawn
    return { model: 'claude-sonnet-5-5', agentId: `teacher-${spawned.length}` }
  })
  // The band drawn beneath ours (another plugin's, or the engine's own): empty unless a test gives it text.
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return Box({ children: bandText ? Text({ children: bandText }) : [] })
  })
  return spawned
}

const edit = (file: string, from: string, to: string, extra: Record<string, unknown> = {}) =>
  ({ tool: 'Edit', file_path: file, old_string: from, new_string: to, ...extra }) as never

const endTurn = ($: Engine, turnId: string, agentId?: string, answer = '') =>
  $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer', ...(agentId ? { agentId } : {}) })

// The agents the engine would list: `$.agent.list()` reads them from this hook.
const listAgents = (on: On, agents: Array<{ id: string; type: string }>) =>
  on('agent.list', () => ({ value: agents.map((a) => ({ ...a, description: 'd', status: 'running' })) }) as never)

// A rewrite of `count` lines of `word`, as the edit's old and new text.
const lines = (word: string, count: number) => Array.from({ length: count }, (_, i) => `${word} ${i}`).join('\n')

const pane = ($: Engine) => $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: PLUGIN, props: PANE_PROPS })
const teach = ($: Engine, args = '') => $.command.run({ command: 'teach', args } as never) // the test's `$` also asks for origin and presentation, which the engine stamps

describe('recording', () => {
  test('an Edit in the main loop is recorded once the turn completes', async ($, on) => {
    engineBeneath(on)
    await $.tool.call(edit('/p/a.ts', 'one', 'two'))
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ type: 'Text', text: /Teachable Moment: \d edit/ })).toBeUndefined()

    await endTurn($, 't1')
    expect(await band.find({ type: 'Text', text: /Teachable Moment: 1 edit \(press t\)/ })).toBeDefined()
    expect(await band.find({ key: 'open-teach' })).toBeDefined()

    const view = await pane($)
    expect(await view.find({ type: 'Text', text: /turn 1 · step 1 of 1/ })).toBeDefined()
    expect(await view.find({ type: 'Text', text: 'Edit' })).toBeDefined()
  })

  test('the band keeps what is drawn beneath it, ahead of or without our hint', async ($, on) => {
    engineBeneath(on, 'replay band below')
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    // Nothing to show: the band below is passed through untouched.
    expect(await band.find({ type: 'Text', text: 'replay band below' })).toBeDefined()
    expect(await band.find({ key: 'open-teach' })).toBeUndefined()

    await $.tool.call(edit('/p/a.ts', 'one', 'two'))
    await endTurn($, 't1')
    // Something to show: our hint and the band below are both present.
    expect(await band.find({ type: 'Text', text: /Teachable Moment: 1 edit/ })).toBeDefined()
    expect(await band.find({ key: 'open-teach' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: 'replay band below' })).toBeDefined()
  })

  test('a subagent edit is recorded in its own group when that subagent\'s turn completes, labelled with its type', async ($, on) => {
    engineBeneath(on)
    listAgents(on, [{ id: 'sub1', type: 'savvy-careful' }])
    await $.tool.call(edit('/p/a.ts', 'one', 'two', { agentId: 'sub1' }))
    await endTurn($, 'sub-turn', 'sub1')
    const view = await pane($)
    expect(await view.find({ type: 'Text', text: 'turn 1 · savvy-careful · step 1 of 1' })).toBeDefined()
    expect(await view.find({ type: 'Text', text: '/p/a.ts' })).toBeDefined()
  })

  test('a subagent that the agent list does not know is labelled "subagent"', async ($, on) => {
    engineBeneath(on)
    await $.tool.call(edit('/p/a.ts', 'one', 'two', { agentId: 'sub1' }))
    await endTurn($, 'sub-turn', 'sub1')
    expect(await (await pane($)).find({ type: 'Text', text: 'turn 1 · subagent · step 1 of 1' })).toBeDefined()
  })

  test('an agent whose lookup fails is labelled "subagent" and is looked up at most twice', async ($, on) => {
    engineBeneath(on)
    let lookups = 0
    on('agent.list', () => { lookups++; throw new Error('list is down') })
    for (let i = 0; i < 5; i++) await $.tool.call(edit(`/p/f${i}.ts`, 'a', 'b', { agentId: 'sub1' }))
    await endTurn($, 'sub-turn', 'sub1')
    await $.tool.call(edit('/p/g.ts', 'a', 'b', { agentId: 'sub1' }))
    await $.tool.call(edit('/p/h.ts', 'a', 'b', { agentId: 'sub1' }))
    await endTurn($, 'sub-turn-2', 'sub1')
    expect(lookups).toBeLessThanOrEqual(2)
    const view = await pane($)
    expect(await view.find({ type: 'Text', text: 'turn 2 · subagent · step 1 of 7' })).toBeDefined()
    expect(await view.find({ type: 'Text', text: /^turn 1 · subagent/ })).toBeUndefined() // not on this step
  })

  test('a subagent turn commits only its own edits, the main turn only the main ones', async ($, on) => {
    engineBeneath(on)
    listAgents(on, [{ id: 'sub1', type: 'Explore' }, { id: 'sub2', type: 'reviewer' }])
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    const recorded = (n: number) => band.find({ type: 'Text', text: new RegExp(`Teachable Moment: ${n} edit`) })

    await $.tool.call(edit('/p/main.ts', 'a', 'b'))
    await $.tool.call(edit('/p/sub1.ts', 'a', 'b', { agentId: 'sub1' }))
    await $.tool.call(edit('/p/sub2.ts', 'a', 'b', { agentId: 'sub2' }))
    expect(await recorded(1)).toBeUndefined() // nothing committed yet

    await endTurn($, 'main-turn')
    expect(await recorded(1)).toBeDefined() // only the main loop's edit
    await endTurn($, 'sub1-turn', 'sub1')
    expect(await recorded(2)).toBeDefined()
    await endTurn($, 'sub1-again', 'sub1') // nothing left pending: no empty group
    expect(await recorded(2)).toBeDefined()
    await endTurn($, 'sub2-turn', 'sub2')
    expect(await recorded(3)).toBeDefined()

    const view = await pane($) // newest group first
    expect(await view.find({ type: 'Text', text: 'turn 3 · reviewer · step 1 of 3' })).toBeDefined()
    expect(await view.find({ type: 'Text', text: '/p/sub2.ts' })).toBeDefined()
    await view.press({ key: 'next' })
    expect(await view.find({ type: 'Text', text: 'turn 2 · Explore · step 2 of 3' })).toBeDefined()
    await view.press({ key: 'next' })
    expect(await view.find({ type: 'Text', text: 'turn 1 · step 3 of 3' })).toBeDefined()
    expect(await view.find({ type: 'Text', text: '/p/main.ts' })).toBeDefined()
  })

  test('a subagent turn that was aborted still commits what it edited', async ($, on) => {
    engineBeneath(on)
    await $.tool.call(edit('/p/a.ts', 'one', 'two', { agentId: 'sub1' }))
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 'x', reason: 'aborted', agentId: 'sub1' })
    expect(await (await pane($)).find({ type: 'Text', text: /step 1 of 1/ })).toBeDefined()
  })

  test('the loops of an agent this mod started are never recorded', () => {
    // The test kit drops the agentId a spawn is answered with, so the mod never
    // learns a Teacher's id here: its check is exercised directly.
    const state = { spawned: new Set(['teacher-9']), waiting: new Map([['teacher-10', { target: { kind: 'edit' as const, id: 1 }, cancel: () => {} }]]) }
    expect(isOurs(state, 'teacher-9')).toBe(true)
    expect(isOurs(state, 'teacher-10')).toBe(true)
    expect(isOurs(state, 'sub1')).toBe(false)
  })

  test('with /teach off a subagent edit is not recorded', async ($, on) => {
    engineBeneath(on)
    await teach($, 'off')
    await $.tool.call(edit('/p/a.ts', 'one', 'two', { agentId: 'sub1' }))
    await endTurn($, 'sub-turn', 'sub1')
    await endTurn($, 't1')
    expect((await teach($)).text).toBe('Teachable Moment: no edits recorded yet.')
  })

  test('a failed subagent edit is not recorded', async ($, on) => {
    on('tool.call', () => ({ deny: 'nope' }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await $.tool.call(edit('/p/a.ts', 'one', 'two', { agentId: 'sub1' }))
    await endTurn($, 'sub-turn', 'sub1')
    expect((await teach($)).text).toBe('Teachable Moment: no edits recorded yet.')
  })

  test('/teach off stops recording and /teach on resumes it', async ($, on) => {
    engineBeneath(on)
    expect((await teach($, 'off')).text).toBe("Teachable Moment paused. Edits made now won't be recorded.")
    await $.tool.call(edit('/p/a.ts', 'one', 'two'))
    await endTurn($, 't1')
    expect((await teach($)).text).toBe('Teachable Moment: no edits recorded yet.')

    expect((await teach($, 'on')).text).toBe('Teachable Moment recording.')
    await $.tool.call(edit('/p/a.ts', 'one', 'two'))
    await endTurn($, 't2')
    expect(await (await pane($)).find({ type: 'Text', text: /step 1 of 1/ })).toBeDefined()
    expect((await teach($, 'sideways')).text).toContain('Usage:')
  })

  test('steps from several turns are kept, newest turn first', async ($, on) => {
    engineBeneath(on)
    await $.tool.call(edit('/p/first.ts', 'a', 'b'))
    await endTurn($, 't1')
    await $.tool.call(edit('/p/second.ts', 'a', 'b'))
    await $.tool.call(edit('/p/third.ts', 'a', 'b'))
    await endTurn($, 't2')

    const view = await pane($)
    expect(await view.find({ type: 'Text', text: /turn 2 · step 1 of 3/ })).toBeDefined()
    expect(await view.find({ type: 'Text', text: '/p/second.ts' })).toBeDefined()
    await view.press({ key: 'next' })
    expect(await view.find({ type: 'Text', text: '/p/third.ts' })).toBeDefined()
    await view.press({ key: 'next' })
    expect(await view.find({ type: 'Text', text: /turn 1 · step 3 of 3/ })).toBeDefined()
    expect(await view.find({ type: 'Text', text: '/p/first.ts' })).toBeDefined()

    expect(orderSteps([{ turn: 1, n: 'a' }, { turn: 2, n: 'b' }, { turn: 2, n: 'c' }]).map((s) => s.n)).toEqual(['b', 'c', 'a'])
  })
})

describe('opening and the step cap', () => {
  const twoEdits = async ($: Engine) => {
    await $.tool.call(edit('/p/a.ts', 'one', 'two'))
    await $.tool.call(edit('/p/b.ts', 'one', 'two'))
    await endTurn($, 't1')
  }

  test('opening twice keeps the step being viewed', async ($, on) => {
    engineBeneath(on)
    const opens: unknown[] = []
    on('ui.open', (_$, e) => { opens.push(e); return { value: { isPlaced: true } } })
    const clock = mock.clock(on)
    await twoEdits($)

    const first = teach($)
    await clock.advance(200)
    await first
    const view = await pane($)
    await view.press({ key: 'next' })
    expect(await view.find({ type: 'Text', text: /step 2 of 2/ })).toBeDefined()

    await teach($) // already open: no sleep to wait out, no second ui.open, no reset to step 1
    expect(opens).toHaveLength(1)
    expect(await view.find({ type: 'Text', text: /step 2 of 2/ })).toBeDefined()
  })

  test('a ui.open that fails leaves the pane closed and the band back', async ($, on) => {
    engineBeneath(on)
    on('ui.open', () => ({ deny: 'no pane today' }))
    const clock = mock.clock(on)
    await twoEdits($)

    const run = teach($)
    await clock.advance(200)
    expect((await run).text).toBe("Teachable Moment couldn't open its pane.")
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ key: 'open-teach' })).toBeDefined() // not stuck as "open"
  })

  test('when the viewed oldest step is dropped at the cap, the viewer moves to the oldest left', async ($, on) => {
    engineBeneath(on)
    for (let i = 0; i < 200; i++) await $.tool.call(edit(`/p/f${i}.ts`, 'a', 'b'))
    await endTurn($, 't1')
    const view = await pane($)
    await view.press({ key: 'prev' }) // now on the oldest step, /p/f0.ts
    expect(await view.find({ type: 'Text', text: '/p/f0.ts' })).toBeDefined()

    await $.tool.call(edit('/p/new.ts', 'a', 'b'))
    await endTurn($, 't2') // 201 steps: f0 is dropped
    expect(await view.find({ type: 'Text', text: '/p/f1.ts' })).toBeDefined()
    expect(await view.find({ type: 'Text', text: /turn 1 · step 2 of 200/ })).toBeDefined()
  })
})

describe('explaining', () => {
  test('parses the HIGH LEVEL / LOW LEVEL format, with a fallback', () => {
    expect(parseExplanation('HIGH LEVEL:\nIt adds a guard.\nLOW LEVEL:\nStep 1.\nStep 2.')).toEqual({
      high: 'It adds a guard.', low: 'Step 1.\nStep 2.',
    })
    expect(parseExplanation('HIGH LEVEL: only this')).toEqual({ high: 'only this', low: '' })
    expect(parseExplanation('no markers at all')).toEqual({ high: '', low: 'no markers at all' })
    expect(wrapText('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })

  test('a finished Teacher turn becomes an explanation or an error', () => {
    const turn = { reason: 'answer', answer: 'HIGH LEVEL:\nWhy.\nLOW LEVEL:\nHow.', isAborted: false }
    expect(explanationFor(turn)).toEqual({ status: 'done', high: 'Why.', low: 'How.', scroll: 0 })
    expect(explanationFor({ ...turn, answer: '  ' })).toEqual({ status: 'error', reason: 'it gave an empty answer' })
    expect(explanationFor({ ...turn, reason: 'aborted', isAborted: true })).toEqual({ status: 'error', reason: 'it was interrupted' })
    expect(explanationFor({ ...turn, reason: 'error' })).toEqual({ status: 'error', reason: 'the request failed' })
    expect(explanationFor({ ...turn, reason: 'refusal' })).toEqual({ status: 'error', reason: 'the model declined' })
  })

  // The test kit strips `agentId` from a spawn answered beneath the plugin (core
  // alone sets it), so a real Teacher's answer cannot be matched here: the spawn
  // itself is checked, and a spawn with no id must end in an error with Retry.
  test('Explain edit spawns the Teacher with the whole edit; a spawn that never started offers Retry', async ($, on) => {
    const spawned = engineBeneath(on)
    await $.tool.call(edit('/p/a.ts', 'one', 'two'))
    await endTurn($, 't1')

    const view = await pane($)
    expect((await view.find({ key: 'explain' }))?.text).toContain('Explain edit')
    expect((await view.find({ key: 'explain-turn' }))?.text).toContain('Explain turn')
    await view.press({ key: 'explain' })
    expect(spawned).toHaveLength(1)
    expect(spawned[0]).toContain('File: /p/a.ts')
    expect(spawned[0]).toContain('Absolute path: /p/a.ts')
    expect(spawned[0]).toContain('Tool: Edit')
    expect(spawned[0]).toContain('- one')
    expect(spawned[0]).toContain('+ two')
    expect(await view.find({ type: 'Text', text: /Teacher couldn't explain this/ })).toBeDefined()
    expect((await view.find({ key: 'explain' }))?.text).toContain('Retry')
    await view.press({ key: 'explain' })
    expect(spawned).toHaveLength(2)
  })

  test('the prompt for a 500-line rewrite still carries the added lines', async ($, on) => {
    const spawned = engineBeneath(on)
    await $.tool.call(edit('/p/big.ts', lines('old', 500), lines('new', 500)))
    await endTurn($, 't1')
    await (await pane($)).press({ key: 'explain' })

    const prompt = spawned[0]!
    expect(prompt).toContain('=====DIFF START=====')
    expect(prompt).toContain('- old 0')
    expect(prompt).toContain('+ new 0')
    expect(prompt).toContain('+ new 149')
    expect(prompt).not.toContain('+ new 150')
    expect(prompt).toContain('350 more added lines not kept')
  })

  test('splits the turn diff budget fairly, small steps keeping all they have', () => {
    expect(allocateBudget([5, 1000, 1000])).toEqual([5, 197, 198])
    expect(allocateBudget([1000, 1000, 1000]).reduce((a, b) => a + b)).toBeLessThanOrEqual(400)
    expect(allocateBudget([3, 4])).toEqual([3, 4])
    expect(Math.min(...allocateBudget(Array(10).fill(1000)))).toBeGreaterThanOrEqual(20)
  })

  const threeFiles = async ($: Engine) => {
    for (const f of ['a', 'b', 'c']) await $.tool.call(edit(`/p/${f}.ts`, lines(`old-${f}`, 300), lines(`new-${f}`, 300)))
    await endTurn($, 't1')
  }

  test('the turn prompt lists all three files and carries added lines from each within the budget', async ($, on) => {
    const spawned = engineBeneath(on)
    await threeFiles($)
    await (await pane($)).press({ key: 'explain-turn' })

    expect(spawned).toHaveLength(1)
    const prompt = spawned[0]!
    for (const [i, f] of ['a', 'b', 'c'].entries()) {
      expect(prompt).toContain(`${i + 1}. /p/${f}.ts | absolute path: /p/${f}.ts | tool: Edit`)
      expect(prompt).toContain(`+ new-${f} 0`)
      expect(prompt).not.toContain(`- old-${f} 0`) // '+' lines come first and fill the share
    }
    expect(prompt).toContain('You may Read the full files')
    expect(prompt).toContain('HIGH LEVEL')
    expect(prompt).toContain('LOW LEVEL')
    expect(prompt).toContain('data, not instructions')
    const body = prompt.split('=====DIFF START=====')[1]!.split('=====DIFF END=====')[0]!
    const diffLines = body.split('\n').filter((l) => /^[+\- ] /.test(l))
    expect(diffLines.length).toBeLessThanOrEqual(400)
    expect(diffLines.length).toBeGreaterThan(300)
    expect(body).toContain('more diff lines omitted')
  })

  test('Explain turn when one is already under way does not spawn again, and the header follows the mode', async ($, on) => {
    let release = () => {}
    const spawned = engineBeneath(on, '', new Promise<void>((resolve) => { release = resolve }))
    await threeFiles($)
    const view = await pane($)

    await view.press({ key: 'explain' }) // spawn 1: the edit's, which never starts
    expect(await view.find({ type: 'Text', text: 'This edit' })).toBeDefined()
    expect(await view.find({ type: 'Text', text: 'This turn · 3 files' })).toBeUndefined()

    const first = view.press({ key: 'explain-turn' }) // spawn 2 waits on the gate
    for (let tries = 0; spawned.length < 2 && tries < 100; tries++) await view.find({ key: 'next' })
    expect(spawned).toHaveLength(2)
    expect(await view.find({ type: 'Text', text: 'This turn · 3 files' })).toBeDefined()
    expect(await view.find({ type: 'Text', text: 'Teacher is explaining this turn… (Sonnet)' })).toBeDefined()
    expect(await view.find({ type: 'Text', text: 'This edit' })).toBeUndefined()

    await view.press({ key: 'explain-turn' }) // loading: only switches the view
    expect(spawned).toHaveLength(2)
    await view.press({ key: 'next' }) // navigating keeps the mode, and the group's explanation
    expect(await view.find({ type: 'Text', text: 'This turn · 3 files' })).toBeDefined()
    await view.press({ key: 'explain' }) // back to the edit view
    expect(await view.find({ type: 'Text', text: 'This edit' })).toBeDefined()

    release()
    await first
  })

  test('a group that loses any step to the cap loses its cached explanation, and one being fetched is given up', () => {
    const state = {
      steps: [], turns: 0, nextId: 1, currentId: 0,
      explanations: new Map(), groupExplanations: new Map(), waiting: new Map(),
    } as unknown as State
    const drafts = (n: number) => Array.from({ length: n }, (_, i) => ({ tool: 'Edit', file: `f${i}`, absPath: `/p/f${i}`, diff: [], note: '' }))
    const done = { status: 'done' as const, high: 'h', low: 'l', scroll: 0 }
    let cancelled = 0
    commitDrafts(state, drafts(150)) // group 1
    commitDrafts(state, drafts(50)) // group 2: 200 steps, nothing cut
    state.groupExplanations.set(1, done)
    state.groupExplanations.set(2, done)
    state.waiting.set('t1', { target: { kind: 'turn', id: 1 }, cancel: () => { cancelled++ } })
    state.waiting.set('t2', { target: { kind: 'turn', id: 2 }, cancel: () => { cancelled++ } })
    expect([...state.groupExplanations.keys()]).toEqual([1, 2])

    commitDrafts(state, drafts(1)) // group 3 cuts one step of group 1
    expect([...state.groupExplanations.keys()]).toEqual([2])
    expect([...state.waiting.keys()]).toEqual(['t2'])
    expect(cancelled).toBe(1)
    expect(state.steps).toHaveLength(200)
  })

  test('control characters and escape sequences are stripped from untrusted text', () => {
    expect(cleanText('a\x1b[31mred\x1b[0m\x07b\tc\nd\r')).toBe('aredb\tc\nd')
    expect(cleanText('x\x1b]0;title\x07y')).toBe('xy')
  })

  test('a turn of some other subagent is ignored', async ($, on) => {
    engineBeneath(on)
    await $.tool.call(edit('/p/a.ts', 'one', 'two'))
    await endTurn($, 't1')
    await endTurn($, 'other', 'someone-else', 'HIGH LEVEL:\nx\nLOW LEVEL:\ny')
    const view = await pane($)
    expect(await view.find({ type: 'Text', text: 'High level' })).toBeUndefined()
    expect(await view.find({ type: 'Text', text: /step 1 of 1/ })).toBeDefined()
  })

  test('the model is never offered the Teacher', async ($, on) => {
    engineBeneath(on)
    const offer = await $.agent.offer({
      agent: 'teachable-moment:teacher', description: 'x', source: 'plugin', provider: { plugin: PLUGIN, tier: 'user' },
    })
    expect(offer.isOffered).toBe(false)
  })
})
