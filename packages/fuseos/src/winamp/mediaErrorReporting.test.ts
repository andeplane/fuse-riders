import { subscribeMediaErrors } from "./mediaErrorReporting";

function dispatchViolation(directive: string) {
  const event = new Event(
    "securitypolicyviolation",
  ) as SecurityPolicyViolationEvent;
  Object.defineProperty(event, "effectiveDirective", { value: directive });
  Object.defineProperty(event, "violatedDirective", { value: directive });
  document.dispatchEvent(event);
}

describe(subscribeMediaErrors.name, () => {
  it("reports a CSP block when a securitypolicyviolation names a media directive", () => {
    const onError = vi.fn();
    subscribeMediaErrors(onError);

    dispatchViolation("media-src");

    expect(onError).toHaveBeenCalledWith({
      cause: "csp",
      directive: "media-src",
    });
  });

  it("ignores security policy violations for unrelated directives", () => {
    const onError = vi.fn();
    subscribeMediaErrors(onError);

    dispatchViolation("img-src");

    expect(onError).not.toHaveBeenCalled();
  });

  it("reports a generic failure when an audio element fails to load", () => {
    const onError = vi.fn();
    subscribeMediaErrors(onError);
    const audio = document.createElement("audio");
    document.body.appendChild(audio);

    try {
      audio.dispatchEvent(new Event("error"));
      expect(onError).toHaveBeenCalledWith({
        cause: "unknown",
        element: audio,
      });
    } finally {
      document.body.removeChild(audio);
    }
  });

  it("ignores an error event whose target is not a media element", () => {
    const onError = vi.fn();
    subscribeMediaErrors(onError);
    const div = document.createElement("div");
    document.body.appendChild(div);

    try {
      div.dispatchEvent(new Event("error"));
      expect(onError).not.toHaveBeenCalled();
    } finally {
      document.body.removeChild(div);
    }
  });

  it("stops listening once unsubscribed", () => {
    const onError = vi.fn();
    const unsubscribe = subscribeMediaErrors(onError);
    unsubscribe();

    dispatchViolation("media-src");

    expect(onError).not.toHaveBeenCalled();
  });
});
