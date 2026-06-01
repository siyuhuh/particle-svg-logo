export type SanitizedSvg =
  | {
      ok: true;
      svgText: string;
    }
  | {
      ok: false;
      error: string;
    };

export function sanitizeSvgText(svgText: string): SanitizedSvg {
  const trimmed = svgText.trim();

  if (!trimmed) {
    return { ok: false, error: "SVG source is empty." };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(trimmed, "image/svg+xml");
  const parserError = doc.querySelector("parsererror");

  if (parserError) {
    return { ok: false, error: "SVG markup could not be parsed." };
  }

  const svg = doc.documentElement;

  if (!svg || svg.nodeName.toLowerCase() !== "svg") {
    return { ok: false, error: "Source must have an <svg> root element." };
  }

  svg.querySelectorAll("script, foreignObject, iframe, object, embed").forEach((node) => {
    node.remove();
  });

  svg.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();

      if (name.startsWith("on")) {
        node.removeAttribute(attribute.name);
      }

      if ((name.endsWith("href") || name === "src") && value.startsWith("javascript:")) {
        node.removeAttribute(attribute.name);
      }
    });
  });

  return {
    ok: true,
    svgText: new XMLSerializer().serializeToString(svg)
  };
}
