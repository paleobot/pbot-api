import { shield, rule, and, or, not, allow, deny } from 'graphql-shield';

const isAuthenticated = rule({ cache: 'contextual' })(async (parent, args, ctx, info) => {
    console.log("isAuthenticated");
    console.log(ctx.user);
    return ctx.user !== null
});

const isAdmin = rule({ cache: 'contextual' })(async (parent, args, ctx, info) => {
    console.log("isAdmin");
    console.log(ctx.user.roles.includes('admin'));
    return ctx.user.roles.includes('admin');
});

const permissions = shield({
    Query: {
        "*": allow,
    },  
    Mutation: {
        "*":  and(isAuthenticated, isAdmin)
    },
},
{
    debug: true,
    allowExternalErrors: true
})


export default permissions;
