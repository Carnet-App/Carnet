// Who's signed in on this phone (user id and email), for code outside React's tree of props.
let me = { id: null, email: null };
export const setMe = (session) => { me = { id: session?.user?.id || null, email: session?.user?.email?.toLowerCase() || null }; };
export const getMe = () => me;
