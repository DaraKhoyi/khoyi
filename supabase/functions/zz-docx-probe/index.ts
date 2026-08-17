// TEMPORARY probe — does the docx library run in the edge runtime? Delete after.
Deno.serve(async () => {
  try {
    const m = await import("https://esm.sh/docx@8.5.0");
    const d = new m.Document({ sections: [{ children: [new m.Paragraph({ children: [new m.TextRun("hello")] })] }] });
    const buf = await m.Packer.toBuffer(d);
    const u = new Uint8Array(buf);
    return new Response(JSON.stringify({
      ok: true, bytes: u.byteLength,
      zip_magic: String.fromCharCode(u[0], u[1]),      // must be "PK"
    }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e).slice(0, 400) }), { headers: { "content-type": "application/json" } });
  }
});
