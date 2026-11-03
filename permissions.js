import { AuthenticationError, ForbiddenError } from 'apollo-server';

//getUser falls back to the shared "guest" Person when a request has no token
//or an invalid one, so the guest user counts as unauthenticated here.
const GUEST_EMAIL = 'guest';

const isAuthenticated = (user) =>
    !!user && !!user.pbotID && user.email !== GUEST_EMAIL;

const isAdmin = (user) =>
    Array.isArray(user.roles) && user.roles.includes('admin');

//Keyed on the Mutation type rather than on individual fields, so every
//mutation (including ones added to schema.graphql later) is gated: fails closed.
//Queries are not gated; read access is governed by cypherParams group scoping.
const permissions = {
    Mutation: async (resolve, parent, args, ctx, info) => {
        if (!isAuthenticated(ctx.user)) {
            throw new AuthenticationError("You must be logged in to do this");
        }
        if (!isAdmin(ctx.user)) {
            throw new ForbiddenError("Not authorized to do this");
        }
        return resolve(parent, args, ctx, info);
    },
};

export default permissions;
