/**
 * Words that appear in the names of cameras that are really software: they make up a picture rather than
 * read one from a lens (streaming tools, phone-as-webcam apps, face and background effects, screen capture).
 */
const VIRTUAL_NAMES = [
  "virtual",
  "obs",
  "manycam",
  "xsplit",
  "snap camera",
  "splitcam",
  "vcam",
  "droidcam",
  "iriun",
  "epoccam",
  "camo",
  "ndi",
  "webcamoid",
  "e2esoft",
  "youcam",
  "logi capture",
  "nvidia broadcast",
  "unity video capture",
  "streamlabs",
  "mmhmm",
  "chromacam",
  "ecamm",
  "avatarify",
  "facerig",
  "screen capture",
  "screen-capture-recorder",
  "v4l2loopback",
  "loopback",
  "wirecast",
  "vmix",
  "fake",
  "dummy",
];

const PATTERN = new RegExp(
  `(^|[^a-z0-9])(${VIRTUAL_NAMES.map((n) => n.replace(/[-\s]/g, "[-\\s]?")).join("|")})([^a-z0-9]|$)`,
  "i",
);

/**
 * Does this camera's name look like a virtual camera? This is a guess from the name the camera gives itself:
 * software can use an ordinary-looking name, and a real camera could have an odd one. It is a signal for
 * the other person to weigh, not proof, and a camera with no name (before permission is given) is not flagged.
 */
export function looksVirtual(label: string): boolean {
  const name = label.trim();
  return name.length > 0 && PATTERN.test(name);
}
