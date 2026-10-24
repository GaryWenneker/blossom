export const COUNTRIES = Object.freeze([
  ["AR","Argentina"],["AT","Austria"],["AU","Australia"],["BE","Belgium"],["BR","Brazil"],
  ["CA","Canada"],["CH","Switzerland"],["CL","Chile"],["CO","Colombia"],["CZ","Czechia"],
  ["DE","Germany"],["DK","Denmark"],["ES","Spain"],["FI","Finland"],["FR","France"],
  ["GB","United Kingdom"],["GR","Greece"],["HU","Hungary"],["IE","Ireland"],["IN","India"],
  ["IT","Italy"],["JP","Japan"],["KR","South Korea"],["MX","Mexico"],["NL","Netherlands"],
  ["NO","Norway"],["NZ","New Zealand"],["PL","Poland"],["PT","Portugal"],["RO","Romania"],
  ["SE","Sweden"],["TR","Turkey"],["US","United States"],["ZA","South Africa"]
].map(([code,name]) => Object.freeze({ code, name })));

export const COUNTRY_CODES = new Set(COUNTRIES.map(country => country.code));
