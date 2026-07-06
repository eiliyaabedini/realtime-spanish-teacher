import { describe, expect, it } from "vitest";
import { localGrade } from "@/lib/lesson-machine/localGrade";

describe("localGrade — free transcript vs expected line", () => {
  it("passes exact and near-exact repeats", () => {
    expect(localGrade("Hola a todos.", "Hola a todos.")).toBe("pass");
    expect(localGrade("Hola a todos.", "hola a todos")).toBe("pass");
  });

  it("is accent- and punctuation-insensitive", () => {
    expect(localGrade("¿Qué tal?", "que tal")).toBe("pass");
    expect(localGrade("Adiós.", "adios")).toBe("pass");
  });

  it("passes when the expected phrase is embedded in fillers", () => {
    expect(localGrade("Hola a todos.", "eh… hola a todos, sí")).toBe("pass");
  });

  it("fails clearly wrong answers", () => {
    expect(localGrade("Hola a todos.", "no tengo ni idea")).toBe("fail");
  });

  it("sends the ambiguous middle to the model", () => {
    expect(localGrade("Hola.", "Ola")).toBe("unsure");
  });

  it("treats empty transcripts as unsure (model hears the audio)", () => {
    expect(localGrade("Hola.", "")).toBe("unsure");
  });
});
