# Frontend release-testing checkpoint

Completed on 2026-09-15 against the locally deployed production web image.

## Release fixes

- Application, calendar, board, and Career Library load failures now have visible,
  retryable states and are not presented as legitimate empty data.
- A Google Calendar connection-status failure no longer prevents the LaunchPad
  calendar feed from rendering.
- Application and board cards can be opened with Enter or Space and expose their
  actions when keyboard focus is inside the card.
- Calendar days and calendar events are separate native buttons. The month grid
  contains no nested interactive controls, and category filters expose their
  selected state.
- Mobile navigation now identifies itself as a modal navigation dialog, focuses
  its close control, closes with Escape, and labels icon-only controls.
- Page-level add-application controls are omitted when a page has no matching
  action.
- The shared layout permits flex children to shrink correctly, eliminating the
  Settings horizontal overflow found at phone width.
- Search fields and library subsection controls now expose explicit accessible
  names and selection state.
- The advanced application form keeps the dialog shell stable, scrolls only its
  form body, associates labels with controls, and restores focus to the first
  editable field when switching modes.

## Automated gate

The frontend suite contains 22 passing tests across five suites. Coverage includes:

- protected and public route behavior;
- invite-only login and local-registration visibility;
- application CSV validation, application creation, failure recovery, filters,
  and keyboard detail opening;
- calendar feed recovery, isolated integration failure, accessible day/event
  controls, and filter state;
- board recovery and keyboard detail opening;
- Career Library recovery and subsection state;
- profile and preference saves, account export failure, and account-deletion
  retry/cancel behavior;
- mobile navigation focus, Escape handling, labels, and conditional actions.
- advanced application-form mode switching, focus placement, and label association.

The optimized React production build compiled successfully. The same build was
then produced inside the release container and deployed locally.

## Deployed browser gate

The deployed image was checked at 1440 x 900 and 390 x 844 without changing saved
records.

- Desktop Calendar: one month grid, 35 accessible day actions, 11 visible event
  actions, no nested buttons, no horizontal overflow, desktop navigation visible.
- Mobile Calendar: six bottom-navigation destinations, desktop sidebar hidden,
  no nested buttons, no horizontal overflow.
- Mobile navigation: drawer visible as a modal dialog, close button receives focus,
  Escape closes it.
- Mobile Applications: 100 cards loaded, all 100 keyboard-focusable, search and
  filter state exposed, Enter opened the live application-detail dialog.
- Mobile Career Library: all four sections present, labeled search, no horizontal
  overflow.
- Mobile Settings: all five settings sections present; after the layout fix the
  root and main widths match at 385 px and horizontal overflow is absent.
- No browser console errors were captured during the final pass.

The deployed web manifest list is
`sha256:ce38bd26e3cb315ee086d5b265077357c6359327a102b494795b43a18ba22214`.

This checkpoint validates the current local release candidate. It does not replace
the clean-environment production drill or testing against the eventual public
domain, production OAuth configuration, and production monitoring.
