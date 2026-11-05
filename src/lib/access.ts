// What the user may do with the open board (from the server: their role, or
// what its share link allows). The editors ask here before changing anything;
// the server refuses changes from viewers and commenters as well.

import { ROLE_LABEL, roleCanComment, roleCanEdit, roleCanManage } from "./roles";
import { openDoc } from "./workspace";

/** Edit the open board (editors, co-owners, the owner; the desktop app's own files are the user's) */
export const canEdit = () => roleCanEdit(openDoc()?.role);

/** Comment on the open board */
export const canComment = () => roleCanComment(openDoc()?.role);

/** Decide who has access (the owner and co-owners) */
export const canShare = () => roleCanManage(openDoc()?.role);

export { ROLE_LABEL };
