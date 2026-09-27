// Never log raw exception messages, request URLs, bodies, headers or credentials.
export function diagnostic(error:unknown,event:string,route:string,requestId:string) {
 const e=error instanceof Error?error:null;
 const errorType=e&&['Error','TypeError','RangeError','SyntaxError'].includes(e.name)?e.name:'UnknownError';
 const frames=(e?.stack??'').match(/\b(?:index|bookings|admin|reviews|http|mcp|scheduled)\.(?:js|ts):\d+:\d+/g)?.slice(0,6)??[];
 const category=/D1_|SQLITE/.test(e?.message??'')?'storage':'runtime';
 return {event,request_id:requestId,route,error_type:errorType,category,frames};
}
export function routeLabel(path:string) {
 if(['/','/health','/bookings','/queue','/reviews','/mcp','/admin/bookings','/admin/ledger','/admin/reviews','/admin/probe','/admin/probe-targets','/reviews/stats'].includes(path))return path;
 if(/^\/bookings\/bk_[a-f0-9-]+$/.test(path))return '/bookings/:id';
 if(/^\/reviews\/rev_[a-f0-9-]+$/.test(path))return '/reviews/:id';
 if(/^\/admin\/bookings\/bk_[a-f0-9-]+\/status$/.test(path))return '/admin/bookings/:id/status';
 if(/^\/admin\/bookings\/bk_[a-f0-9-]+$/.test(path))return '/admin/bookings/:id';
 if(/^\/reviews\/rev_[a-f0-9-]+\/response$/.test(path))return '/reviews/:id/response';
 if(/^\/admin\/reviews\/rev_[a-f0-9-]+\/response-token$/.test(path))return '/admin/reviews/:id/response-token';
 return 'unmatched';
}
