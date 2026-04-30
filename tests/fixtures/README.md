# Test Fixtures

This directory contains test files used by the end-to-end tests.

## Files

- `test-assignment.pdf` - Sample PDF assignment file for teachers to upload
- `student-solution.pdf` - Sample PDF solution file for students to submit
- `invalid-file.txt` - Invalid file type for testing file validation
- `large-file.pdf` - Large PDF file for testing file size limits

## Usage

These files are used by Playwright tests to simulate real file uploads and downloads during the assignment workflow testing.

## Creating Test PDFs

To create minimal test PDF files, you can use tools like:
- Online PDF generators
- LibreOffice Writer (export as PDF)
- Any text editor that can export to PDF

The content doesn't matter for testing purposes - we just need valid PDF files of appropriate sizes.
