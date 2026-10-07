import { Buffer } from "node:buffer";

function byteLength(value) {
  return Buffer.byteLength(
    value,
    "latin1",
  );
}

function escapePdfText(value) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export function createTextPdf(
  text = "Hello civic registry",
) {
  const escaped =
    escapePdfText(text);
  const stream = [
    "BT",
    "/F1 12 Tf",
    "72 720 Td",
    "(" + escaped + ") Tj",
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " +
      byteLength(stream) +
      " >>\nstream\n" +
      stream +
      "\nendstream",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  objects.forEach(
    (object, index) => {
      offsets.push(
        byteLength(pdf),
      );
      pdf +=
        String(index + 1) +
        " 0 obj\n" +
        object +
        "\nendobj\n";
    },
  );

  const xrefOffset =
    byteLength(pdf);
  pdf +=
    "xref\n0 " +
    String(objects.length + 1) +
    "\n";
  pdf +=
    "0000000000 65535 f \n";

  for (
    let index = 1;
    index < offsets.length;
    index += 1
  ) {
    pdf +=
      String(offsets[index])
        .padStart(10, "0") +
      " 00000 n \n";
  }

  pdf +=
    "trailer\n<< /Size " +
    String(objects.length + 1) +
    " /Root 1 0 R >>\n";
  pdf +=
    "startxref\n" +
    String(xrefOffset) +
    "\n%%EOF\n";

  return new Uint8Array(
    Buffer.from(
      pdf,
      "latin1",
    ),
  );
}
