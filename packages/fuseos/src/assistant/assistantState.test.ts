import {
  ASSISTANT_TIPS,
  tipPrompt,
  GREETING,
  INITIAL_ASSISTANT_STATE,
  assistantReducer,
  assistantZIndex,
  currentMood,
  isAssistantMood,
  isAssistantTool,
  visibleSpeech,
} from './assistantState';

const OPTIONS = { narrate: true, showTips: true };

describe(assistantReducer.name, () => {
  it('narrates a sidebar tool call: thinking while it runs, an explanation when it finishes', () => {
    const started = assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'toolCall', report: { name: 'search', sentence: 'Searching for pump...', phase: 'started' } });
    expect(started.busy).toBe(1);
    expect(started.speech).toMatchObject({ kind: 'narration', text: 'Searching for pump...', mood: 'thinking', seq: 1 });
    expect(started.play).toEqual({ name: 'Thinking', seq: 1 });
    expect(currentMood(started)).toBe('thinking');

    const finished = assistantReducer(started, { type: 'toolCall', report: { name: 'search', sentence: 'Searching for pump...', phase: 'finished' } });
    expect(finished.busy).toBe(0);
    expect(finished.speech).toMatchObject({ kind: 'narration', text: 'Searching for pump...', mood: 'happy', seq: 2 });
    expect(finished.play).toEqual({ name: 'Explain', seq: 2 });
    expect(currentMood(finished)).toBe('happy');
  });

  it('stays thinking while another call is still running and says sorry when one fails', () => {
    const one = assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'toolCall', report: { name: 'a', sentence: 'A...', phase: 'started' } });
    const two = assistantReducer(one, { type: 'toolCall', report: { name: 'b', sentence: 'B...', phase: 'started' } });
    expect(two.play?.name).toBe('Searching');
    const oneDone = assistantReducer(two, { type: 'toolCall', report: { name: 'a', sentence: 'A...', phase: 'finished' } });
    expect(oneDone.busy).toBe(1);
    expect(currentMood(oneDone)).toBe('thinking');
    const failed = assistantReducer(oneDone, { type: 'toolCall', report: { name: 'b', sentence: 'B...', phase: 'failed' } });
    expect(failed.busy).toBe(0);
    expect(failed.speech).toMatchObject({ mood: 'sorry', text: 'Hmm, that did not work. B...' });
    expect(failed.play?.name).toBe('Alert');
    // A stray "finished" never pushes busy below zero.
    expect(assistantReducer(failed, { type: 'toolCall', report: { name: 'b', sentence: 'B...', phase: 'finished' } }).busy).toBe(0);
  });

  it('lists in-app chat tool calls for the turn instead of narrating them', () => {
    const sent = assistantReducer({ ...INITIAL_ASSISTANT_STATE, turnCalls: [{ name: 'old', sentence: 'Old...', phase: 'finished', origin: 'chat' }] }, { type: 'chatSent' });
    expect(sent.turnCalls).toEqual([]);
    expect(sent.play?.name).toBe('Writing');
    const started = assistantReducer(sent, { type: 'toolCall', report: { name: 'navigate', sentence: 'Opening C:\\RAW...', phase: 'started', origin: 'chat' } });
    expect(started.speech).toBeNull();
    expect(started.busy).toBe(1);
    expect(started.turnCalls).toEqual([{ name: 'navigate', sentence: 'Opening C:\\RAW...', phase: 'started', origin: 'chat' }]);
    expect(started.play?.name).toBe('Thinking');
    const finished = assistantReducer(started, { type: 'toolCall', report: { name: 'navigate', sentence: 'Opening C:\\RAW...', phase: 'finished', origin: 'chat' } });
    expect(finished.busy).toBe(0);
    expect(finished.turnCalls).toEqual([{ name: 'navigate', sentence: 'Opening C:\\RAW...', phase: 'finished', origin: 'chat' }]);
    expect(assistantReducer(finished, { type: 'chatAnswered' }).play?.name).toBe('Congratulate');
    expect(assistantReducer(sent, { type: 'chatAnswered' }).play?.name).toBe('Explain');
    expect(assistantReducer(sent, { type: 'chatAnswered', failed: true }).play?.name).toBe('Alert');
  });

  it('does not narrate the assistant tool, so what Atlas says stays on screen', () => {
    const said = assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'say', text: 'Hello there', mood: 'idea' });
    expect(said.speech).toMatchObject({ kind: 'say', text: 'Hello there', mood: 'idea' });
    expect(said.play?.name).toBe('GetAttention');
    const during = assistantReducer(said, { type: 'toolCall', report: { name: 'assistant', sentence: 'Saying...', phase: 'started' } });
    expect(during).toBe(said);
    expect(isAssistantTool('assistant')).toBe(true);
    expect(isAssistantTool('assistant_say')).toBe(true);
    expect(isAssistantTool('search')).toBe(false);
  });

  it('defaults say to happy and notice to sorry', () => {
    expect(assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'say', text: 'x' }).speech?.mood).toBe('happy');
    expect(assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'say', text: 'x' }).play?.name).toBe('Congratulate');
    expect(assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'notice', text: 'x' }).speech?.mood).toBe('sorry');
  });

  it('greets, cycles through the tips and dismisses', () => {
    const greeted = assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'greet' });
    // The greeting carries the first tip, so it is on screen without asking.
    expect(greeted.speech).toMatchObject({ kind: 'greeting', text: `${GREETING} ${ASSISTANT_TIPS[0]}`, mood: 'idea' });
    expect(greeted.tipIndex).toBe(0);
    expect(greeted.play?.name).toBe('Greeting');
    let state = greeted;
    ASSISTANT_TIPS.forEach((_tip, step) => {
      state = assistantReducer(state, { type: 'nextTip' });
      const index = (step + 1) % ASSISTANT_TIPS.length;
      expect(state.tipIndex).toBe(index);
      expect(state.speech).toMatchObject({ kind: 'tip', text: ASSISTANT_TIPS[index] });
      expect(state.play?.name).toBe('GetAttention');
    });
    expect(state.speech?.text).toBe(ASSISTANT_TIPS[0]);
    const dismissed = assistantReducer(state, { type: 'dismiss' });
    // Opening the balloon with nothing to say shows the next tip by itself.
    expect(assistantReducer(dismissed, { type: 'show' }).speech).toMatchObject({ kind: 'tip', text: ASSISTANT_TIPS[1] });
    expect(dismissed.speech).toBeNull();
    expect(currentMood(dismissed)).toBe('idle');
    expect(dismissed.tipIndex).toBe(0);
  });

  it('plays Greeting on show, GoodBye on hide and Wave on hover unless busy', () => {
    expect(assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'show' }).play).toEqual({ name: 'Greeting', seq: 1 });
    expect(assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'hide' }).play?.name).toBe('GoodBye');
    expect(assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'wave' }).play?.name).toBe('Wave');
    const busy = { ...INITIAL_ASSISTANT_STATE, busy: 1 };
    expect(assistantReducer(busy, { type: 'wave' })).toBe(busy);
  });

  it('bumps seq on every speech and every animation so repeats restart', () => {
    const a = assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'say', text: 'a' });
    const b = assistantReducer(a, { type: 'say', text: 'b' });
    expect(b.speech?.seq).toBe((a.speech?.seq ?? 0) + 1);
    expect(b.play?.seq).toBe((a.play?.seq ?? 0) + 1);
  });
});

describe(visibleSpeech.name, () => {
  it('hides narration and tips when switched off, never a greeting, remark or notice', () => {
    const narration = assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'toolCall', report: { name: 'go', sentence: 'Going up...', phase: 'started' } });
    expect(visibleSpeech(narration, OPTIONS)?.text).toBe('Going up...');
    expect(visibleSpeech(narration, { ...OPTIONS, narrate: false })).toBeNull();
    const tip = assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'nextTip' });
    expect(visibleSpeech(tip, { ...OPTIONS, showTips: false })).toBeNull();
    expect(visibleSpeech(tip, OPTIONS)?.kind).toBe('tip');
    const said = assistantReducer(INITIAL_ASSISTANT_STATE, { type: 'say', text: 'hi' });
    expect(visibleSpeech(said, { narrate: false, showTips: false })?.text).toBe('hi');
    expect(visibleSpeech(INITIAL_ASSISTANT_STATE, OPTIONS)).toBeNull();
  });
});

describe(isAssistantMood.name, () => {
  it('accepts the five moods only', () => {
    expect(isAssistantMood('happy')).toBe(true);
    expect(isAssistantMood('thinking')).toBe(true);
    expect(isAssistantMood('angry')).toBe(false);
    expect(isAssistantMood(1)).toBe(false);
  });
});

describe(assistantZIndex.name, () => {
  it('sits above every window and below the first open dialog', () => {
    expect(assistantZIndex([])).toBe(10);
    expect(assistantZIndex([{ kind: 'paint', minimized: false }, { kind: 'winamp', minimized: false }])).toBe(12);
    expect(assistantZIndex([{ kind: 'paint', minimized: false }, { kind: 'dialog', minimized: false }])).toBe(10);
    expect(assistantZIndex([{ kind: 'dialog', minimized: false }])).toBe(9);
    expect(assistantZIndex([{ kind: 'dialog', minimized: true }, { kind: 'paint', minimized: false }])).toBe(12);
  });
});

describe(tipPrompt.name, () => {
  it('extracts the quoted question of a tip and ignores tips without one', () => {
    expect(tipPrompt('Try asking me: "Open Paint and draw a cat." I pick the brush.')).toBe('Open Paint and draw a cat.');
    expect(tipPrompt('Press Alt+Enter on a drive.')).toBeUndefined();
    expect(tipPrompt('An empty "" quote')).toBeUndefined();
  });

  it('finds nothing to send in the shipped tips, so they offer no Try this', () => {
    ASSISTANT_TIPS.forEach((tip) => expect(tipPrompt(tip)).toBeUndefined());
  });
});

describe('working animation', () => {
  it('alternates the animation per running call and wraps around', () => {
    const names: (string | undefined)[] = [];
    let state = INITIAL_ASSISTANT_STATE;
    for (let call = 0; call < 5; call += 1) {
      state = assistantReducer(state, { type: 'toolCall', report: { name: `t${call}`, sentence: 'x', phase: 'started' } });
      names.push(state.play?.name);
    }
    expect(names).toEqual(['Thinking', 'Searching', 'Processing', 'CheckingSomething', 'Thinking']);
  });
});
