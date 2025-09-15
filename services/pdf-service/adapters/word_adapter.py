import os
import tempfile
import pathlib
from typing import Tuple
from rise.generate_certificate import parse_word_form, generate_certificate

async def draft_from_form_and_template(form_file, template_file) -> Tuple[bytes, str]:
    """Generate draft certificate from Word form and PDF template."""
    with tempfile.TemporaryDirectory() as td:
        # Save uploaded form file
        form_path = os.path.join(td, form_file.filename)
        with open(form_path, "wb") as f:
            f.write(await form_file.read())

        # Save uploaded template file
        template_path = os.path.join(td, template_file.filename)
        with open(template_path, "wb") as f:
            f.write(await template_file.read())

        # Parse the Word form to extract values
        values = parse_word_form(form_path)
        
        # Generate output filename
        out_name = pathlib.Path(form_file.filename).with_suffix(".pdf").name
        out_path = os.path.join(td, out_name)
        
        # Generate the certificate using your existing function
        generate_certificate(template_path, out_path, values)

        # Read the generated PDF and return
        with open(out_path, "rb") as f:
            return f.read(), out_name

async def convert_single_word(file) -> Tuple[bytes, str]:
    """Convert a single Word file to PDF (placeholder for future implementation)."""
    # This can be implemented later if you want generic Word→PDF conversion
    raise NotImplementedError("Single-file convert not implemented. Use /draft with form + template.")
