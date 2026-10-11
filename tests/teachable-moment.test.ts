import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cleanText, explanationFor, orderSteps, parseExplanation, wrapText } from '../hooks/teachable-moment'

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
function engineBeneath(on: On, bandText = '') {
  const spawned: string[] = []
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('agent.register', () => ({ value: { agent: 'teachable-moment:teacher' } }))
  on('agent.spawn', (_$, e) => {
    spawned.push(e.prompt)
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

  test('an edit made inside a subagent is not recorded', async ($, on) => {
    engineBeneath(on)
    await $.tool.call(edit('/p/a.ts', 'one', 'two', { agentId: 'sub1' }))
    await endTurn($, 'sub-turn', 'sub1')
    await endTurn($, 't1')
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
  test('Explain this spawns the Teacher with the whole edit; a spawn that never started offers Retry', async ($, on) => {
    const spawned = engineBeneath(on)
    await $.tool.call(edit('/p/a.ts', 'one', 'two'))
    await endTurn($, 't1')

    const view = await pane($)
    expect(await view.find({ key: 'explain' })).toBeDefined()
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
    const lines = (word: string) => Array.from({ length: 500 }, (_, i) => `${word} ${i}`).join('\n')
    await $.tool.call(edit('/p/big.ts', lines('old'), lines('new')))
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
