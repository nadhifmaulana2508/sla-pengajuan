import { Router } from 'express';
import { adminRouter } from '../modules/admin/admin.routes.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { healthRouter } from '../modules/health/health.routes.js';
import { requestRouter } from '../modules/requests/requests.routes.js';
import { inboxRouter } from '../modules/requests/inbox.routes.js';
import { notificationsRouter } from '../modules/notifications/notifications.routes.js';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes.js';
import { formsRouter } from '../modules/forms/forms.routes.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/requests', requestRouter);
apiRouter.use('/inbox', inboxRouter);
apiRouter.use('/notifications', notificationsRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/forms', formsRouter);
apiRouter.use(healthRouter);
