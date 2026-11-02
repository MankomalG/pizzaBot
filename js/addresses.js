/*
 * Mock backend for the PizzaPal Bot prototype.
 * 50 fictional Brampton addresses. No network, no server.
 * To add or change an address, edit the ROWS list: [house number, street, postal code].
 */

// ==== MOCK BACKEND START (address validation, no network, 50 fictional Brampton addresses) ====
var AddressBackend = (function () {
  var CITY = "Brampton";
  var PROVINCE = "ON";

  // [house number, street name, postal code]. All fictional, for prototype testing only.
  var ROWS = [
    ["25", "Main St N", "L6V 1N7"],
    ["140", "Main St S", "L6W 2E1"],
    ["8", "Queen St E", "L6V 1A2"],
    ["212", "Queen St W", "L6X 1B3"],
    ["480", "Queen St E", "L6V 1B7"],
    ["55", "Bovaird Dr E", "L6V 4A1"],
    ["205", "Bovaird Dr E", "L6V 4B1"],
    ["310", "Bovaird Dr W", "L6X 5G2"],
    ["75", "Steeles Ave E", "L6W 3H5"],
    ["1020", "Steeles Ave W", "L6Y 0K1"],
    ["18", "Dixie Rd", "L6T 2K6"],
    ["460", "Dixie Rd", "L6T 3J7"],
    ["33", "Kennedy Rd S", "L6W 3E4"],
    ["190", "Kennedy Rd N", "L6P 1A9"],
    ["72", "Mississauga Rd", "L6Y 5C8"],
    ["900", "Mississauga Rd", "L6Y 0R2"],
    ["15", "Hurontario St", "L6X 0K3"],
    ["640", "Hurontario St", "L6Y 4S5"],
    ["120", "Chinguacousy Rd", "L6Y 2M1"],
    ["305", "Chinguacousy Rd", "L7A 1P6"],
    ["48", "Williams Pkwy", "L6S 5Y1"],
    ["260", "Williams Pkwy", "L6S 4L8"],
    ["5", "Sandalwood Pkwy E", "L6Z 1Y2"],
    ["88", "Sandalwood Pkwy W", "L7A 1H4"],
    ["410", "Mayfield Rd", "L6R 0A3"],
    ["22", "Clarkway Dr", "L6P 0E5"],
    ["150", "Father Tobin Rd", "L6R 0R6"],
    ["64", "Peel Centre Dr", "L6T 4G8"],
    ["200", "Great Lakes Dr", "L6R 2K7"],
    ["31", "Countryside Dr", "L6P 0B4"],
    ["77", "Heart Lake Rd", "L6Z 1C2"],
    ["515", "McLaughlin Rd N", "L6Z 3P1"],
    ["90", "Torbram Rd", "L6T 5B4"],
    ["14", "Airport Rd", "L6T 5G1"],
    ["260", "Bramalea Rd", "L6T 2X6"],
    ["88", "Bramalea Rd", "L6T 2P1"],
    ["36", "Vodden St E", "L6V 4H3"],
    ["12", "Vodden St W", "L6X 1K9"],
    ["105", "Rutherford Rd S", "L6W 3J5"],
    ["380", "Rutherford Rd N", "L6V 4K5"],
    ["67", "Centre St N", "L6V 3M2"],
    ["23", "Church St W", "L6X 1H4"],
    ["140", "Church St E", "L6V 1G2"],
    ["9", "Wexford Rd", "L6Z 2T8"],
    ["52", "Charolais Blvd", "L6Y 2R5"],
    ["18", "Brisdale Dr", "L7A 3G6"],
    ["40", "Veterans Dr", "L7A 4S3"],
    ["120", "Ray Lawson Blvd", "L6Y 5J2"],
    ["16", "Conestoga Dr", "L6Z 4M6"],
    ["410", "Gore Rd", "L6P 2H6"]
  ];

  var ABBR = {
    street: "st", avenue: "ave", road: "rd", drive: "dr", boulevard: "blvd",
    parkway: "pkwy", north: "n", south: "s", east: "e", west: "w"
  };

  // Lowercase, drop punctuation, city/province/postal code, and unify St/Street, N/North, etc.
  function normalize(text) {
    var t = String(text).toLowerCase()
      .replace(/[.,#]/g, " ")
      .replace(/\b[a-z]\d[a-z]\s?\d[a-z]\d\b/g, " ")
      .replace(/\b(brampton|ontario|on|canada)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!t) return "";
    return t.split(" ").map(function (w) { return ABBR[w] || w; }).join(" ");
  }

  var INDEX = {};
  var RECORDS = ROWS.map(function (r) {
    var rec = { street: r[0] + " " + r[1], city: CITY, province: PROVINCE, postal: r[2] };
    INDEX[normalize(rec.street)] = rec;
    return rec;
  });

  function distance(a, b) {
    var prev = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      var cur = [i];
      for (j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  // Exact match after normalization, or null.
  function lookup(text) {
    var key = normalize(text);
    return key && INDEX[key] ? INDEX[key] : null;
  }

  // Closest address within 2 edits (a typo or a missing "N"), or null.
  function suggest(text) {
    var q = normalize(text);
    if (q.length < 5) return null;
    var best = null, bestD = 3;
    RECORDS.forEach(function (rec) {
      var d = distance(q, normalize(rec.street));
      if (d < bestD) { bestD = d; best = rec; }
    });
    return best;
  }

  function sample() { return RECORDS[Math.floor(Math.random() * RECORDS.length)]; }
  function all() { return RECORDS.slice(); }

  return { lookup: lookup, suggest: suggest, sample: sample, all: all, normalize: normalize };
})();
// ==== MOCK BACKEND END ====
