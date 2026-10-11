import { describe, expect, it } from "vitest";
import { looksVirtual } from "../video/virtual.js";

describe("looksVirtual", () => {
  it.each([
    "OBS Virtual Camera",
    "OBS-Camera",
    "ManyCam Virtual Webcam",
    "Snap Camera",
    "XSplit VCam",
    "DroidCam Source 3",
    "NVIDIA Broadcast",
    "Logi Capture",
    "Virtual Camera",
    "mmhmm Virtual Camera",
    "Unity Video Capture",
    "v4l2loopback",
    "Dummy video device (0x0000)",
  ])("flags %s", (name) => {
    expect(looksVirtual(name)).toBe(true);
  });

  it.each([
    "Integrated Camera",
    "HD Webcam C920",
    "FaceTime HD Camera",
    "Logitech BRIO",
    "USB2.0 HD UVC WebCam (13d3:5666)",
    "Front camera",
    "Back Camera",
    "Obstacle Camera", // contains "obs" but is not the word
    "Camera 1",
    "Microphone Array",
    "",
    "   ",
  ])("does not flag %s", (name) => {
    expect(looksVirtual(name)).toBe(false);
  });

  it("ignores letter case", () => {
    expect(looksVirtual("virtual CAMERA")).toBe(true);
  });
});
