# Single source detector pass

The source scan ran once over 214 changed UI files. It returned 10 primary findings and 79 advisories. It uses regular expressions on TSX/CSS and does not establish rendered contrast or behavior.

Independent contextual review concluded that the ten primary findings are preserved font resource registrations, compatibility theme declarations and an `inherit` Tailwind class misread as a font family. Current default text uses the approved system font stack; user-selected fonts and terminal/code faces remain configurable.

The advisory set contains platform brand colors, decorative avatar initials, scaled Appearance thumbnails, terminal/data type sizes, content colors, masks/scrollbars and existing pet motion. These are intentional content/native exceptions, not competing app chrome. Card/title/tab values with an actual shared-system counterpart were replaced with the approved tokens after the scan. No second detector was run.

The independent visual review found two material issues beyond the detector: account cloud-sync spacing and generic icon fallbacks. Both are handled in the final review fix batch, whose evidence and verdict are recorded in verification.md.
