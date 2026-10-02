const ICONS = {
  doctor: `<circle cx="12" cy="12" r="7.25"/><path d="M12 8.75v6.5M8.75 12h6.5"/>`,
  "baby-doctor": `<circle cx="10" cy="8" r="2.2"/><path d="M6.5 18.5v-.8a3.5 3.5 0 0 1 7 0v.8"/><path d="M16.2 6.2v3.2M14.6 7.8h3.2"/>`,
  dentist: `<path d="M8.2 9.2c.2-2.4 1.7-4 3.8-4s3.6 1.6 3.8 4c.2 2.2-.2 3.4-.2 4.6 0 1.3-.7 2.2-1.4 2.2-.7 0-.9-.9-1.2-1.7-.3-.7-.5-.9-1-.9s-.7.2-1 .9c-.3.8-.5 1.7-1.2 1.7-.7 0-1.4-.9-1.4-2.2 0-1.2-.4-2.4-.2-4.6z"/>`,
  pharmacy: `<path d="M8.6 15.4 15.4 8.6a3 3 0 0 1 4.2 4.2l-6.8 6.8a3 3 0 0 1-4.2-4.2z"/><path d="M10.4 13.6 13.6 10.4"/>`,
  vaccine: `<path d="m14.2 5.2 4.6 4.6"/><path d="m12.6 6.8 4.6 4.6"/><path d="M6.2 14.2 11 9.4l3.6 3.6-4.8 4.8a1.8 1.8 0 0 1-2.6 0l-1-1a1.8 1.8 0 0 1 0-2.6z"/><path d="m8.4 16.2-2.2 2.2"/>`,
  midwife: `<path d="M12 18.6s-5.6-3.4-5.6-7.2a3 3 0 0 1 5.6-1.5 3 3 0 0 1 5.6 1.5c0 3.8-5.6 7.2-5.6 7.2z"/>`,
  ultrasound: `<rect x="4.5" y="5" width="15" height="10.5" rx="2"/><path d="M8 18.8h8"/><path d="M7.8 10.4c.7-.7 1.1-.7 1.8 0s1.1.7 1.8 0 1.1-.7 1.8 0 1.1.7 1.8 0"/>`,
  "baby-coming": `<path d="M10 7.2h4"/><path d="M11 7.2V5.6h2v1.6"/><path d="M9.4 9.4h5.2l.7 8.4a1.8 1.8 0 0 1-1.8 2H10.5a1.8 1.8 0 0 1-1.8-2z"/>`,
  delivery: `<path d="M4.8 8.4 12 4.6l7.2 3.8v8.2L12 20.4l-7.2-3.8z"/><path d="M12 12.2v8.2M4.8 8.4 12 12.2l7.2-3.8"/>`,
  bag: `<path d="M7 9.2h10l-.9 9.6H7.9z"/><path d="M9.2 9.2V7.6a2.8 2.8 0 0 1 5.6 0v1.6"/>`,
  prenatal: `<path d="M5 6.8h5.6A1.8 1.8 0 0 1 12.4 8.6V19H7.2A2.2 2.2 0 0 1 5 16.8z"/><path d="M19 6.8h-5.6A1.8 1.8 0 0 0 11.6 8.6V19h5.2A2.2 2.2 0 0 0 19 16.8z"/>`,
  playdate: `<path d="M12 14.2c2.3 0 4-1.8 4-4.1S14.2 6 12 6 8 7.8 8 10.1s1.7 4.1 4 4.1z"/><path d="M12 14.2v1.4"/><path d="M10.6 17.4h2.8"/><path d="M12 15.6c-.5.5-.5 1 0 1.4"/>`,
  school: `<path d="M8.2 10.2V8.8a3.8 3.8 0 0 1 7.6 0v1.4"/><path d="M6.6 10.2h10.8v7.6a1.4 1.4 0 0 1-1.4 1.4H8a1.4 1.4 0 0 1-1.4-1.4z"/><path d="M9.4 14h5.2"/>`,
  travel: `<rect x="5" y="8" width="14" height="10.5" rx="2"/><path d="M9 8V6.6A1.4 1.4 0 0 1 10.4 5.2h3.2A1.4 1.4 0 0 1 15 6.6V8"/><path d="M5 13h14"/>`,
  family: `<path d="M4.5 11.2 12 5l7.5 6.2"/><path d="M7 10.4V19h10v-8.6"/>`,
  flight: `<path d="m3.5 12.2 17-5.2-5.4 13.2-2-4.6z"/><path d="M15.1 7 9.4 15.2"/>`,
  hotel: `<path d="M4.5 18V8.5"/><path d="M4.5 14h15V18"/><path d="M19.5 18v-2.6a2.6 2.6 0 0 0-2.6-2.6H9.2"/><circle cx="8" cy="12.2" r="1.3"/>`,
  dinner: `<path d="M8 4v6.2M6.4 4v3.8M9.6 4v3.8M8 10.2V20"/><path d="M16 4c1.3 1.6 1.3 3.2 0 4.8V20"/>`,
  birthday: `<path d="M6.2 13.2h11.6V19H6.2z"/><path d="M6.2 13.2c.9.7 1.8.7 2.7 0s1.8-.7 2.7 0 1.8.7 2.7 0 1.8-.7 2.7 0"/><path d="M12 10.4V8"/><path d="M12 6.4c.3-.5.3-.9 0-1.3"/>`,
  groceries: `<circle cx="9.6" cy="18.2" r="1.15"/><circle cx="16" cy="18.2" r="1.15"/><path d="M5 6.4h1.8l1.3 8h8.6l1.5-5.4H8.2"/>`,
  work: `<rect x="4.2" y="8" width="15.6" height="10.5" rx="2"/><path d="M9 8V6.6A1.4 1.4 0 0 1 10.4 5.2h3.2A1.4 1.4 0 0 1 15 6.6V8"/><path d="M4.2 12.4h15.6"/>`,
  call: `<path d="M8.4 5h2l.9 2.8-1.5.9a8.2 8.2 0 0 0 3.9 3.9l.9-1.5 2.8.9v2a1.5 1.5 0 0 1-1.6 1.5A12 12 0 0 1 6.9 6.6 1.5 1.5 0 0 1 8.4 5z"/>`,
  car: `<path d="M5.2 16.2h13.6l-1.3-3.8a1.8 1.8 0 0 0-1.7-1.2H8.2a1.8 1.8 0 0 0-1.7 1.2z"/><path d="M6.2 16.2v1.6M17.8 16.2v1.6"/><circle cx="8.2" cy="16.2" r="1.1"/><circle cx="15.8" cy="16.2" r="1.1"/>`,
  bills: `<path d="M7.2 4.6h9.6V19l-1.6-1-1.6 1-1.6-1-1.6 1-1.6-1-1.6 1z"/><path d="M9.4 8.4h5.2M9.4 11.6h5.2"/>`,
  haircut: `<circle cx="7.2" cy="16.4" r="2"/><circle cx="7.2" cy="7.6" r="2"/><path d="m8.8 8.8 8.8 7.2M8.8 15.2 17.6 8"/>`,
  sport: `<circle cx="15.2" cy="5.2" r="1.45"/><path d="M6.6 19.2 10 14l2.2 1.5 1.3-3.1-2.5-1.3 3.2.9 2 3.6"/>`,
  reminder: `<path d="M6.6 16.4h10.8"/><path d="M7.6 16.4c.2-.9.5-1.7.9-2.4.7-1.2.7-2.8.7-4a2.8 2.8 0 0 1 5.6 0c0 1.2 0 2.8.7 4 .4.7.7 1.5.9 2.4"/><path d="M10.4 16.4a1.6 1.6 0 0 0 3.2 0"/>`,
  more: `<path d="M12 6.5v11M6.5 12h11"/>`
};

export function categoryMark(id) {
  const mark = document.createElement("span");
  mark.className = "mark";
  mark.setAttribute("aria-hidden", "true");
  mark.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#fffaf3" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[id] || ICONS.reminder}</svg>`;
  return mark;
}
