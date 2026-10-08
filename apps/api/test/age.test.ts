import { describe, expect, it } from "vitest";
import { statedMinorAge } from "../src/chat/age.js";

describe("statedMinorAge", () => {
  it.each([
    ["hey im 14 f", 14],
    ["I'm 16", 16],
    ["i am only 15 and bored", 15],
    ["Im 17.", 17],
    ["i’m 13 yo", 13],
    ["im 12 y/o", 12],
    ["im 16 years old", 16],
    ["hi, im 15 btw", 15],
    ["i am 14 boy", 14],
  ])("flags %j as age %i", (text, age) => {
    expect(statedMinorAge(text)).toBe(age);
  });

  it.each([
    "I'm 15 minutes late sorry",
    "im 100% sure",
    "I am 25",
    "im 10 km away",
    "im 18",
    "I'm 40 and bored",
    "im 2 tired to talk",
    "my sister is 14",
    "hello there",
    "",
  ])("leaves %j alone", (text) => {
    expect(statedMinorAge(text)).toBeNull();
  });
});
